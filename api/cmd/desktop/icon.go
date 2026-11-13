package main

import _ "embed"

//go:generate go -C ../../../tools/icon run .

//go:embed assets/icon.png
var appIcon []byte
