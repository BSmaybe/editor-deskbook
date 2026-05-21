package store

import (
	"context"
	"errors"
	"time"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewUserStore(pool *pgxpool.Pool) *UserStore {
	return &UserStore{
		pool: pool,
		q:    db.New(pool),
	}
}

type UserRow struct {
	ID             int        `json:"id"`
	Username       string     `json:"username"`
	Email          string     `json:"email"`
	HashedPassword string     `json:"-"`
	Role           string     `json:"role"`
	CreatedAt      *time.Time `json:"created_at"`
	FullName       *string    `json:"full_name"`
	Department     *string    `json:"department"`
	Position       *string    `json:"position"`
	Phone          *string    `json:"phone"`
	UserStatus     string     `json:"user_status"`
	IsActive       bool       `json:"is_active"`
}

type UserPublic struct {
	ID         int     `json:"id"`
	Username   string  `json:"username"`
	Email      string  `json:"email"`
	Role       string  `json:"role"`
	FullName   *string `json:"full_name"`
	Department *string `json:"department"`
	Position   *string `json:"position"`
	Phone      *string `json:"phone"`
	UserStatus string  `json:"user_status"`
	IsActive   bool    `json:"is_active"`
}

func (u *UserRow) ToPublic() UserPublic {
	return UserPublic{
		ID: u.ID, Username: u.Username, Email: u.Email, Role: u.Role,
		FullName: u.FullName, Department: u.Department, Position: u.Position,
		Phone: u.Phone, UserStatus: u.UserStatus, IsActive: u.IsActive,
	}
}

func mapDBUserToUserRow(u db.User) UserRow {
	return UserRow{
		ID:             int(u.ID),
		Username:       u.Username,
		Email:          u.Email,
		HashedPassword: u.HashedPassword,
		Role:           u.Role,
		CreatedAt:      dateToPtr(u.CreatedAt),
		FullName:       textToPtr(u.FullName),
		Department:     textToPtr(u.Department),
		Position:       textToPtr(u.Position),
		Phone:          textToPtr(u.Phone),
		UserStatus:     u.UserStatus,
		IsActive:       u.IsActive,
	}
}

func (s *UserStore) GetByUsername(ctx context.Context, username string) (*UserRow, error) {
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	row := mapDBUserToUserRow(u)
	return &row, nil
}

func (s *UserStore) GetByEmail(ctx context.Context, email string) (*UserRow, error) {
	id, err := s.q.GetUserEmailID(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &UserRow{ID: int(id)}, nil
}

func (s *UserStore) GetByID(ctx context.Context, id int) (*UserRow, error) {
	u, err := s.q.GetUserByID(ctx, int32(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	row := mapDBUserToUserRow(u)
	return &row, nil
}

func (s *UserStore) Create(ctx context.Context, username, email, hashedPw, role string) (*UserRow, error) {
	u, err := s.q.CreateUser(ctx, db.CreateUserParams{
		Username:       username,
		Email:          email,
		HashedPassword: hashedPw,
		Role:           role,
	})
	if err != nil {
		return nil, err
	}
	row := mapDBUserToUserRow(u)
	return &row, nil
}

func (s *UserStore) List(ctx context.Context) ([]UserRow, error) {
	users, err := s.q.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]UserRow, len(users))
	for i, u := range users {
		result[i] = mapDBUserToUserRow(u)
	}
	return result, nil
}

func (s *UserStore) UpdateRole(ctx context.Context, username, role string, isActive bool) (*UserRow, error) {
	u, err := s.q.UpdateUserRole(ctx, db.UpdateUserRoleParams{
		Username: username,
		Role:     role,
		IsActive: isActive,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	row := mapDBUserToUserRow(u)
	return &row, nil
}

func (s *UserStore) Delete(ctx context.Context, username string) error {
	rowsAffected, err := s.q.DeleteUser(ctx, username)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

