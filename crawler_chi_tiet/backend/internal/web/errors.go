package web

import "errors"

var (
	ErrNotFound      = errors.New("not found")
	ErrAlreadyExists = errors.New("already exists")
	ErrCSVNotReady   = errors.New("csv not ready")
	ErrCSVEmpty      = errors.New("csv is empty")
)
