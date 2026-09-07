package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"easyssh/api/internal/model"
	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

const maxUploadSize int64 = 2 << 30

type remoteFileView struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Type       string    `json:"type"`
	Size       int64     `json:"size"`
	Mode       string    `json:"mode"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

func (a *API) openSFTP(host model.Host) (*gossh.Client, *sftp.Client, error) {
	auth, err := a.sshAuth(host)
	if err != nil {
		return nil, nil, fmt.Errorf("SSH credential could not be loaded")
	}
	sshClient, err := gossh.Dial("tcp", net.JoinHostPort(host.Address, strconv.Itoa(host.Port)), &gossh.ClientConfig{User: host.Username, Auth: []gossh.AuthMethod{auth}, HostKeyCallback: gossh.InsecureIgnoreHostKey(), Timeout: 10 * time.Second})
	if err != nil {
		return nil, nil, fmt.Errorf("SSH connection failed")
	}
	client, err := sftp.NewClient(sshClient)
	if err != nil {
		sshClient.Close()
		return nil, nil, fmt.Errorf("SFTP is unavailable on this host")
	}
	return sshClient, client, nil
}

func (a *API) fileHome(w http.ResponseWriter, r *http.Request) {
	host, ok := a.find(w, r)
	if !ok {
		return
	}
	sshClient, client, err := a.openSFTP(host)
	if err != nil {
		failMessage(w, 422, err.Error())
		return
	}
	defer sshClient.Close()
	defer client.Close()
	workingDir, err := client.Getwd()
	if err != nil {
		failMessage(w, 422, "Could not determine the remote home directory")
		return
	}
	writeJSON(w, 200, map[string]string{"path": cleanRemotePath(workingDir)})
}

func (a *API) listRemoteFiles(w http.ResponseWriter, r *http.Request) {
	host, ok := a.find(w, r)
	if !ok {
		return
	}
	target := cleanRemotePath(r.URL.Query().Get("path"))
	sshClient, client, err := a.openSFTP(host)
	if err != nil {
		failMessage(w, 422, err.Error())
		return
	}
	defer sshClient.Close()
	defer client.Close()
	entries, err := client.ReadDir(target)
	if err != nil {
		failMessage(w, 422, safeSFTPError(err, "Could not read the remote directory"))
		return
	}
	items := make([]remoteFileView, 0, len(entries))
	for _, entry := range entries {
		entryType := "file"
		if entry.IsDir() {
			entryType = "directory"
		} else if entry.Mode()&os.ModeSymlink != 0 {
			entryType = "symlink"
		} else if !entry.Mode().IsRegular() {
			entryType = "other"
		}
		items = append(items, remoteFileView{Name: entry.Name(), Path: path.Join(target, entry.Name()), Type: entryType, Size: entry.Size(), Mode: entry.Mode().String(), ModifiedAt: entry.ModTime()})
	}
	parent := path.Dir(target)
	if target == "/" {
		parent = ""
	}
	writeJSON(w, 200, map[string]any{"path": target, "parent": parent, "items": items})
}

func (a *API) downloadRemoteFile(w http.ResponseWriter, r *http.Request) {
	host, ok := a.find(w, r)
	if !ok {
		return
	}
	target := cleanRemotePath(r.URL.Query().Get("path"))
	sshClient, client, err := a.openSFTP(host)
	if err != nil {
		failMessage(w, 422, err.Error())
		return
	}
	defer sshClient.Close()
	defer client.Close()
	info, err := client.Stat(target)
	if err != nil {
		failMessage(w, 404, "Remote file was not found")
		return
	}
	if !info.Mode().IsRegular() {
		failMessage(w, 400, "Only regular files can be downloaded")
		return
	}
	file, err := client.Open(target)
	if err != nil {
		failMessage(w, 422, "Could not open the remote file")
		return
	}
	defer file.Close()
	name := path.Base(target)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err = io.Copy(w, file); err != nil {
		return
	}
}

func (a *API) uploadRemoteFile(w http.ResponseWriter, r *http.Request) {
	host, ok := a.find(w, r)
	if !ok {
		return
	}
	directory := cleanRemotePath(r.URL.Query().Get("path"))
	overwrite := r.URL.Query().Get("overwrite") == "true"
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		failMessage(w, 400, "Expected multipart file upload")
		return
	}
	var partName string
	var part io.Reader
	for {
		next, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			failMessage(w, 400, "Invalid multipart upload")
			return
		}
		if next.FileName() != "" {
			partName = path.Base(strings.ReplaceAll(next.FileName(), "\\", "/"))
			part = next
			break
		}
	}
	if part == nil || !validUploadName(partName) {
		failMessage(w, 400, "A valid file is required")
		return
	}
	sshClient, client, err := a.openSFTP(host)
	if err != nil {
		failMessage(w, 422, err.Error())
		return
	}
	defer sshClient.Close()
	defer client.Close()
	target := path.Join(directory, partName)
	targetInfo, statErr := client.Stat(target)
	if statErr == nil && !overwrite {
		failMessage(w, http.StatusConflict, "A file with the same name already exists")
		return
	}
	if statErr == nil && !targetInfo.Mode().IsRegular() {
		failMessage(w, http.StatusConflict, "The existing remote path is not a regular file")
		return
	}
	temp := path.Join(directory, fmt.Sprintf(".%s.easyssh-upload-%d", partName, time.Now().UnixNano()))
	// The nanosecond suffix makes the temporary name unique. Avoid O_EXCL here:
	// a number of otherwise functional SFTP servers reject that flag.
	file, err := client.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		failMessage(w, 422, safeSFTPError(err, "Could not create a file in the remote directory"))
		return
	}
	written, copyErr := io.Copy(file, part)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = client.Remove(temp)
		failMessage(w, 422, "Upload was interrupted")
		return
	}
	if overwrite {
		err = replaceRemoteFile(client, temp, target)
	} else {
		err = client.Rename(temp, target)
	}
	if err != nil {
		_ = client.Remove(temp)
		failMessage(w, 422, "Could not finalize the remote file")
		return
	}
	writeJSON(w, 201, map[string]any{"name": partName, "path": target, "size": written, "status": "uploaded"})
}

func replaceRemoteFile(client *sftp.Client, temp, target string) error {
	if err := client.PosixRename(temp, target); err == nil {
		return nil
	}
	backup := fmt.Sprintf("%s.easyssh-backup-%d", target, time.Now().UnixNano())
	if err := client.Rename(target, backup); err != nil {
		return err
	}
	if err := client.Rename(temp, target); err != nil {
		_ = client.Rename(backup, target)
		return err
	}
	_ = client.Remove(backup)
	return nil
}

func cleanRemotePath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "."
	}
	cleaned := path.Clean(strings.ReplaceAll(value, "\\", "/"))
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}
	return cleaned
}
func validUploadName(value string) bool {
	return value != "" && value != "." && value != ".." && !strings.ContainsAny(value, "/\\\r\n") && len([]byte(value)) <= 255
}
func safeSFTPError(err error, fallback string) string {
	var status *sftp.StatusError
	if errors.As(err, &status) {
		switch status.Code {
		case 2:
			return "Remote path was not found"
		case 3:
			return "Permission denied by the remote host"
		}
	}
	return fallback
}
