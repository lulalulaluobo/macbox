package apps

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type CommunityStoreSource struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Enabled   bool   `json:"enabled"`
	UpdatedAt string `json:"updatedAt"`
}

type CommunityStoreManager struct {
	cachePath string
	mu        sync.RWMutex
	cached    []BuiltinAppDefinition
}

func NewCommunityStoreManager(dataDir string) *CommunityStoreManager {
	cachePath := filepath.Join(dataDir, "appstore_cache.json")
	mgr := &CommunityStoreManager{
		cachePath: cachePath,
	}
	mgr.loadCache()
	return mgr
}

func (sm *CommunityStoreManager) loadCache() {
	data, err := os.ReadFile(sm.cachePath)
	if err != nil {
		return
	}
	var list []BuiltinAppDefinition
	if err := json.Unmarshal(data, &list); err == nil {
		sm.cached = list
	}
}

func (sm *CommunityStoreManager) saveCache() error {
	data, err := json.MarshalIndent(sm.cached, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(sm.cachePath, data, 0644)
}

func (sm *CommunityStoreManager) GetApps() []BuiltinAppDefinition {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.cached
}

// Sync fetches the latest community app catalog
func (sm *CommunityStoreManager) Sync(ctx context.Context) (int, error) {
	// Example feed from stable fast raw CDN
	// If online sync fails, we maintain offline high-quality presets
	feedURLs := []string{
		"https://raw.githubusercontent.com/IceWhaleTech/CasaOS-AppStore/main/apps.json",
		"https://fastly.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/apps.json",
	}

	client := &http.Client{Timeout: 10 * time.Second}
	var fetchedData []byte

	for _, u := range feedURLs {
		req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			buf := make([]byte, 2*1024*1024)
			n, _ := resp.Body.Read(buf)
			fetchedData = buf[:n]
			break
		}
	}

	if len(fetchedData) > 0 {
		// Parse if valid
		var remoteApps []BuiltinAppDefinition
		if err := json.Unmarshal(fetchedData, &remoteApps); err == nil && len(remoteApps) > 0 {
			sm.mu.Lock()
			sm.cached = remoteApps
			_ = sm.saveCache()
			sm.mu.Unlock()
			return len(remoteApps), nil
		}
	}

	// Fallback to our extensive built-in catalog if network unreachable
	catalog := GetBuiltinCatalog()
	sm.mu.Lock()
	sm.cached = catalog
	_ = sm.saveCache()
	sm.mu.Unlock()

	return len(catalog), nil
}
