package auth

import (
	"testing"
)

func TestTokenLifecycle(t *testing.T) {
	secret := "my-secret-key"
	username := "john_doe"
	role := "admin"

	// 1. Issue a valid token
	token, err := IssueToken(username, role, secret, 5)
	if err != nil {
		t.Fatalf("failed to issue token: %v", err)
	}

	// 2. Verify token successfully
	claims, err := VerifyToken(token, secret)
	if err != nil {
		t.Fatalf("failed to verify valid token: %v", err)
	}

	if claims.Username != username {
		t.Errorf("expected username %q, got %q", username, claims.Username)
	}
	if claims.Role != role {
		t.Errorf("expected role %q, got %q", role, claims.Role)
	}

	// 3. Fail verification with invalid secret
	_, err = VerifyToken(token, "wrong-secret")
	if err == nil {
		t.Error("expected verification to fail with wrong secret, but it succeeded")
	}

	// 4. Test expired token
	expiredToken, err := IssueToken(username, role, secret, -1)
	if err != nil {
		t.Fatalf("failed to issue expired token: %v", err)
	}
	_, err = VerifyToken(expiredToken, secret)
	if err == nil {
		t.Error("expected verification of expired token to fail, but it succeeded")
	}
}
