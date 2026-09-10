package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// GetFS returns an fs.FS rooted at dist
func GetFS() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return distFS
	}
	return sub
}
