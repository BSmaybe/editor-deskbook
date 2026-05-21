package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type InviteStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewInviteStore(pool *pgxpool.Pool) *InviteStore {
	return &InviteStore{
		pool: pool,
		q:    db.New(pool),
	}
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

func mapDBInviteToInviteRow(i db.Invite) InviteRow {
	return InviteRow{
		ID:        int(i.ID),
		Token:     i.Token,
		Email:     i.Email,
		Role:      i.Role,
		CreatedBy: int4ToPtr(i.CreatedBy),
		CreatedAt: timestamptzToPtr(i.CreatedAt),
		ExpiresAt: timestamptzToPtr(i.ExpiresAt),
		UsedAt:    timestamptzToPtr(i.UsedAt),
	}
}

func (s *InviteStore) Create(ctx context.Context, email, role string, createdBy int, expiresAt *time.Time) (*InviteRow, error) {
	token, err := GenerateToken()
	if err != nil {
		return nil, err
	}
	dbInv, err := s.q.CreateInvite(ctx, db.CreateInviteParams{
		Token:     token,
		Email:     email,
		Role:      role,
		CreatedBy: pgtype.Int4{Int32: int32(createdBy), Valid: true},
		ExpiresAt: ptrToTimestamptz(expiresAt),
	})
	if err != nil {
		return nil, err
	}
	row := mapDBInviteToInviteRow(dbInv)
	return &row, nil
}

func (s *InviteStore) List(ctx context.Context) ([]InviteRow, error) {
	dbInvs, err := s.q.ListInvites(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]InviteRow, len(dbInvs))
	for i, inv := range dbInvs {
		result[i] = mapDBInviteToInviteRow(inv)
	}
	return result, nil
}

func (s *InviteStore) GetByToken(ctx context.Context, token string) (*InviteRow, error) {
	dbInv, err := s.q.GetInviteByToken(ctx, token)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	row := mapDBInviteToInviteRow(dbInv)
	return &row, nil
}

func (s *InviteStore) MarkUsed(ctx context.Context, id int) error {
	return s.q.MarkInviteUsed(ctx, int32(id))
}

func (s *InviteStore) Delete(ctx context.Context, id int) error {
	rowsAffected, err := s.q.DeleteInvite(ctx, int32(id))
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

