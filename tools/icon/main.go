// Regenerates the Windows ICO and architecture-specific executable resources.
// Run from this directory, or use go generate ./cmd/desktop from api.
package main

import (
	"image/png"
	"log"
	"os"
	"path/filepath"

	"github.com/tc-hib/winres"
)

func main() {
	if err := generate(); err != nil {
		log.Fatal(err)
	}
}

func generate() error {
	dir := filepath.Join("..", "..", "api", "cmd", "desktop")
	input, err := os.Open(filepath.Join(dir, "assets", "icon.png"))
	if err != nil {
		return err
	}
	defer input.Close()
	image, err := png.Decode(input)
	if err != nil {
		return err
	}
	icon, err := winres.NewIconFromResizedImage(image, []int{16, 20, 24, 32, 40, 48, 64, 128, 256})
	if err != nil {
		return err
	}
	output, err := os.Create(filepath.Join(dir, "assets", "icon.ico"))
	if err != nil {
		return err
	}
	if err = icon.SaveICO(output); err != nil {
		output.Close()
		return err
	}
	if err = output.Close(); err != nil {
		return err
	}
	resources := winres.ResourceSet{}
	// Wails loads IDI_APPLICATION (32512) for the taskbar and title bar.
	// Explorer uses the first icon group from the same executable resources.
	if err = resources.SetIcon(winres.ID(32512), icon); err != nil {
		return err
	}
	for name, arch := range map[string]winres.Arch{"amd64": winres.ArchAMD64, "arm64": winres.ArchARM64} {
		output, err = os.Create(filepath.Join(dir, "icon_windows_"+name+".syso"))
		if err != nil {
			return err
		}
		if err = resources.WriteObject(output, arch); err != nil {
			output.Close()
			return err
		}
		if err = output.Close(); err != nil {
			return err
		}
	}
	return nil
}
