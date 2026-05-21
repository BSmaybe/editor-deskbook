package handler

import (
	"sync"
	"time"
)

type LockEvent struct {
	Locked           bool      `json:"locked"`
	FloorID          int       `json:"floor_id"`
	LockedByID       int       `json:"locked_by_id,omitempty"`
	LockedByUsername string    `json:"locked_by_username,omitempty"`
	LockedAt         time.Time `json:"locked_at,omitempty"`
	ExpiresAt        time.Time `json:"expires_at,omitempty"`
}

type LockBroker struct {
	mu          sync.RWMutex
	subscribers map[int][]chan LockEvent
}

func NewLockBroker() *LockBroker {
	return &LockBroker{
		subscribers: make(map[int][]chan LockEvent),
	}
}

func (b *LockBroker) Subscribe(floorID int) chan LockEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	ch := make(chan LockEvent, 10)
	b.subscribers[floorID] = append(b.subscribers[floorID], ch)
	return ch
}

func (b *LockBroker) Unsubscribe(floorID int, ch chan LockEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	subs, exists := b.subscribers[floorID]
	if !exists {
		return
	}
	for i, sub := range subs {
		if sub == ch {
			close(ch)
			b.subscribers[floorID] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	if len(b.subscribers[floorID]) == 0 {
		delete(b.subscribers, floorID)
	}
}

func (b *LockBroker) Broadcast(floorID int, event LockEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	subs, exists := b.subscribers[floorID]
	if !exists {
		return
	}
	for _, sub := range subs {
		select {
		case sub <- event:
		default:
		}
	}
}
