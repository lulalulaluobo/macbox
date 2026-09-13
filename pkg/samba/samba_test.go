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

func TestValidateShareName(t *testing.T) {
	for _, name := range []string{"硬盘2", "家庭照片", "MacBox-SSD", "共享_01"} {
		if err := validateShareName(name); err != nil {
			t.Errorf("validateShareName(%q) returned error: %v", name, err)
		}
	}
	for _, name := range []string{"", "share name", "share/path", "share[bad]", "share\nname"} {
		if err := validateShareName(name); err == nil {
			t.Errorf("validateShareName(%q) accepted an unsafe name", name)
		}
	}
}
