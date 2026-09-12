package config

import "testing"

func TestValidateCloudMount(t *testing.T) {
	valid := CloudMount{ID: "quark-main", Provider: "quark", Name: "夸克网盘", Cookie: "sid=test", RootFid: "0"}
	if err := ValidateCloudMount(valid); err != nil {
		t.Fatal(err)
	}
	invalid := valid
	invalid.Provider = "unknown"
	if err := ValidateCloudMount(invalid); err == nil {
		t.Fatal("expected unsupported provider to be rejected")
	}
}
