package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserStore struct {
	pool *pgxpool.Pool
}

func NewUserStore(pool *pgxpool.Pool) *UserStore {
	return &UserStore{pool: pool}
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

func (s *UserStore) GetByUsername(ctx context.Context, username string) (*UserRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, username, email, hashed_password, role, created_at,
		        full_name, department, position, phone, user_status, is_active
		 FROM users WHERE username = $1`, username)
	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func (s *UserStore) GetByEmail(ctx context.Context, email string) (*UserRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE email = $1`, email)
	var id int
	err := row.Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &UserRow{ID: id}, nil
}

func (s *UserStore) GetByID(ctx context.Context, id int) (*UserRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, username, email, hashed_password, role, created_at,
		        full_name, department, position, phone, user_status, is_active
		 FROM users WHERE id = $1`, id)
	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func (s *UserStore) Create(ctx context.Context, username, email, hashedPw, role string) (*UserRow, error) {
	row := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, email, hashed_password, role)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, username, email, hashed_password, role, created_at,
		           full_name, department, position, phone, user_status, is_active`,
		username, email, hashedPw, role)
	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	return &u, err
}

func (s *UserStore) List(ctx context.Context) ([]UserRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, username, email, hashed_password, role, created_at,
		        full_name, department, position, phone, user_status, is_active
		 FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []UserRow
	for rows.Next() {
		var u UserRow
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
			&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive); err != nil {
			return nil, err
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (s *UserStore) UpdateRole(ctx context.Context, username, role string, isActive bool) (*UserRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE users SET role = $2, is_active = $3 WHERE username = $1
		 RETURNING id, username, email, hashed_password, role, created_at,
		           full_name, department, position, phone, user_status, is_active`, username, role, isActive)
	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func (s *UserStore) Delete(ctx context.Context, username string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM users WHERE username = $1`, username)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
