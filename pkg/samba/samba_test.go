package samba

import "testing"

func TestNormalizeSharePathRestrictsSharesToDataRoot(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
		valid bool
	}{
		{name: "data root", input: "/data", want: "/data", valid: true},
		{name: "nested data", input: "/data/media/../downloads", want: "/data/downloads", valid: true},
		{name: "system path", input: "/etc", valid: false},
		{name: "traversal", input: "/data/../etc", valid: false},
		{name: "relative", input: "data", valid: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeSharePath(tt.input)
			if tt.valid {
				if err != nil || got != tt.want {
					t.Fatalf("normalizeSharePath(%q) = %q, %v; want %q", tt.input, got, err, tt.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("normalizeSharePath(%q) accepted unsafe path %q", tt.input, got)
			}
		})
	}
}
