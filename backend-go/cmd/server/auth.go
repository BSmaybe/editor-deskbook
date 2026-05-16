package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

type tokenClaims struct {
	Sub  string  `json:"sub"`
	Role string  `json:"role"`
	Exp  float64 `json:"exp"`
}

func requireAdmin(r *http.Request) error {
	claims, err := requireAuthContext(r)
	if err != nil {
		return err
	}
	if claims.Role != "admin" {
		return errForbidden
	}
	return nil
}

type authContext struct {
	Username string
	Role     string
}

func requireAdminContext(r *http.Request) (authContext, error) {
	claims, err := requireAuthContext(r)
	if err != nil {
		return authContext{}, err
	}
	if claims.Role != "admin" {
		return authContext{}, errForbidden
	}
	return claims, nil
}

func requireAuthContext(r *http.Request) (authContext, error) {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(auth, "Bearer ") {
		return authContext{}, errors.New("missing bearer token")
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return authContext{}, errors.New("invalid token")
	}

	secret := strings.TrimSpace(os.Getenv("SECRET_KEY"))
	if secret == "" {
		secret = "change-me-in-production"
	}
	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	expected := mac.Sum(nil)
	actual, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(actual, expected) {
		return authContext{}, errors.New("invalid token signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return authContext{}, errors.New("invalid token payload")
	}
	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return authContext{}, errors.New("invalid token claims")
	}
	if claims.Exp > 0 && int64(claims.Exp) < time.Now().Unix() {
		return authContext{}, errors.New("token expired")
	}
	if strings.TrimSpace(claims.Role) == "" {
		return authContext{}, errors.New("missing token role")
	}
	return authContext{
		Username: strings.TrimSpace(claims.Sub),
		Role:     strings.TrimSpace(claims.Role),
	}, nil
}
