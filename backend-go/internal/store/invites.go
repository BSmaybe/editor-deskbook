package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type InviteStore struct {
	pool *pgxpool.Pool
}

func NewInviteStore(pool *pgxpool.Pool) *InviteStore {
	return &InviteStore{pool: pool}
}

type InviteRow struct {
	ID        int        `json:"id"`
	Token     string     `json:"token"`
	Email     string     `json:"email"`
	Role      string     `json:"role"`
	CreatedBy *int       `json:"created_by"`
	CreatedAt *time.Time `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at"`
}

func GenerateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *InviteStore) Create(ctx context.Context, email, role string, createdBy int, expiresAt *time.Time) (*InviteRow, error) {
	token, err := GenerateToken()
	if err != nil {
		return nil, err
	}
	row := s.pool.QueryRow(ctx,
		`INSERT INTO invites (token, email, role, created_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, token, email, role, created_by, created_at, expires_at, used_at`,
		token, email, role, createdBy, expiresAt)
	var inv InviteRow
	err = row.Scan(&inv.ID, &inv.Token, &inv.Email, &inv.Role, &inv.CreatedBy,
		&inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt)
	return &inv, err
}

func (s *InviteStore) List(ctx context.Context) ([]InviteRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, token, email, role, created_by, created_at, expires_at, used_at
		 FROM invites ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []InviteRow
	for rows.Next() {
		var inv InviteRow
		if err := rows.Scan(&inv.ID, &inv.Token, &inv.Email, &inv.Role, &inv.CreatedBy,
			&inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt); err != nil {
			return nil, err
		}
		result = append(result, inv)
	}
	return result, rows.Err()
}

func (s *InviteStore) GetByToken(ctx context.Context, token string) (*InviteRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, token, email, role, created_by, created_at, expires_at, used_at
		 FROM invites WHERE token = $1`, token)
	var inv InviteRow
	err := row.Scan(&inv.ID, &inv.Token, &inv.Email, &inv.Role, &inv.CreatedBy,
		&inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &inv, err
}

func (s *InviteStore) MarkUsed(ctx context.Context, id int) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE invites SET used_at = NOW() WHERE id = $1`, id)
	return err
}

func (s *InviteStore) Delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM invites WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
