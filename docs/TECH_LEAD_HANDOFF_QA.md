# Пакет Вопросов Техлида Для DeskBook Editor

## Вопросы И Ожидаемые Ответы

1. **Как поднимается проект локально?**  
   `docker compose up -d --build`; сервисы: `postgres`, `migrate`, `api`, `admin`. Готовность API проверяется через `GET /health`.

2. **Где точки входа?**  
   React admin: `http://localhost:5175`; Go API: `http://localhost:8000`; PostgreSQL: `localhost:5432`.

3. **Что является основным продуктовым контуром?**  
   Админский редактор карт: здания, этажи, component library, canvas editor, draft/publish, SVG/HTML export, invite-based регистрация.

4. **Как устроены роли и авторизация?**  
   `POST /auth/login` выдаёт HS256 JWT с claim `sub`, `role`, `exp`. Admin write operations требуют `role=admin`. Первый админ создаётся из env-переменных `BOOTSTRAP_ADMIN_*`.

5. **Как новые пользователи получают доступ?**  
   Админ создаёт invite для конкретного email (`POST /admin/invites`). Пользователь получает ссылку `/?invite=<token>`, регистрируется. Invite одноразовый и может иметь срок действия.

6. **Где схема БД и как запускаются миграции?**  
   Схема в `backend-go/migrations/001_schema.sql`; compose-сервис `migrate` применяет её перед стартом `api`.

7. **Какие API критичны для редактора?**  
   `/offices`, `/floors`, `/components`, `/blocks`, `/templates`, `/floors/{id}/layout/*`, `/floors/{id}/lock`, `/render/svg`, `/render/html`, `/admin/invites`, `/desks`.

8. **Как рабочие места попадают в таблицу `desks`?**  
   Из опубликованного `layout_json`: publish/sync берёт только `asset_type=workplace` и не создаёт записи для chair/custom asset объектов.

9. **Какие проверки обязательны перед релизом?**  
   `go test ./...` в `backend-go`, `npm run build` в `frontend/admin-react`, затем contract tests и `bash tests/smoke_test.sh` на поднятом compose-стеке.

10. **Как настроить production?**  
    `bash scripts/gen-secrets.sh` генерирует `.env.production` с рандомными секретами. Бэкап: `bash scripts/backup.sh`. Восстановление: `bash scripts/restore.sh <file>`. Cleanup старых ревизий: `POST /admin/cleanup/revisions?older_than_days=90`.

## Live Checklist

1. Запустить `docker compose up -d --build`.
2. Открыть `http://localhost:5175`.
3. Войти админом (bootstrap credentials из `.env`).
4. Перейти в «Приглашения», создать invite.
5. Открыть invite-ссылку, зарегистрировать пользователя.
6. Создать здание и этаж.
7. Открыть этаж в layout editor.
8. Создать или импортировать layout draft.
9. Опубликовать layout.
10. Проверить `published.svg` и `published.html`.
11. Прогнать `bash tests/smoke_test.sh`.
