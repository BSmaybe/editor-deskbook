# Пакет Вопросов Техлида Для DeskBook Editor

Документ фиксирует актуальное состояние после миграции в Go + React editor-only контур.

## Вопросы И Ожидаемые Ответы

1. **Как поднимается проект локально?**  
   `docker compose up -d --build`; сервисы: `postgres`, `migrate`, `api`, `admin`. Готовность API проверяется через `GET /health`.

2. **Где точки входа?**  
   React admin: `http://localhost:5175`; Go API: `http://localhost:8000`; PostgreSQL: `localhost:5432`.

3. **Что является основным продуктовым контуром?**  
   Админский редактор карт: здания, этажи, component library, canvas editor, draft/publish, SVG/HTML export.

4. **Что заморожено?**  
   Booking, reservations, policies, analytics, QR/check-in, landing, demo mode и клиентское приложение. Их compatibility routes возвращают `501 Not Implemented`.

5. **Как устроены роли и авторизация?**  
   `POST /auth/login` выдаёт HS256 JWT с claim `sub`, `role`, `exp`. Admin write operations требуют `role=admin`.

6. **Где схема БД и как запускаются миграции?**  
   Схема в `backend-go/migrations/001_schema.sql`; compose-сервис `migrate` применяет её перед стартом `api`.

7. **Какие API критичны для редактора?**  
   `/offices`, `/floors`, `/components`, `/floors/{id}/layout/*`, `/floors/{id}/lock`, `/render/svg`, `/render/html`.

8. **Как рабочие места попадают в таблицу `desks`?**  
   Из опубликованного `layout_json`: publish/sync берёт только `asset_type=workplace` и не создаёт записи для chair/custom asset объектов.

9. **Какие проверки обязательны перед релизом?**  
   `go test ./...` в `backend-go`, `npm run build` в `frontend/admin-react`, затем contract tests и `tests/smoke_test.sh` на поднятом compose-стеке.

10. **Какие основные риски остаются?**  
   Нужны production-настройки секретов, backup/rollback регламент для PostgreSQL, и отдельное решение по будущему размораживанию booking/client модулей.

## Live Checklist

1. Запустить `docker compose up -d --build`.
2. Открыть `http://localhost:5175`.
3. Войти админом.
4. Создать здание и этаж.
5. Открыть этаж в layout editor.
6. Создать или импортировать layout draft.
7. Опубликовать layout.
8. Проверить `published.svg` и `published.html`.
9. Прогнать `bash tests/smoke_test.sh`.
