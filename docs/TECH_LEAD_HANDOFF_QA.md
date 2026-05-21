# DeskBook — Онбординг для разработчиков

## Быстрый старт

```bash
# 1. Поднять стек
docker compose up -d --build

# 2. Проверить что всё работает
curl http://localhost:8000/health

# 3. Пройти интерактивный онбординг (рекомендуется!)
bash scripts/onboarding.sh
```

Интерактивный скрипт проведёт вас через **все** возможности API за 5–10 минут:
авторизация, приглашения, здания, этажи, компоненты, layout workflow, экспорт,
ревизии, разграничение прав. Каждый шаг объясняет что происходит и почему.

---

## Архитектура

```
┌───────────────────┐     ┌───────────────┐     ┌───────────────┐
│  React Admin      │────▸│  nginx        │────▸│  Go API       │
│  (Vite, :5175)    │     │  /api → :8000 │     │  (net/http)   │
│                   │     │  /static      │     │               │
│  Canvas editor    │     │  /docs(Swagger│     │  JWT auth     │
│  Component lib    │     └───────────────┘     │  handler/     │
│  Draft/Publish UI │                           │  store/       │
└───────────────────┘                           │  exporter/    │
                                                └───────┬───────┘
                                                        │
                                                        ▼
                                                ┌───────────────┐
                                                │  PostgreSQL   │
                                                │  (:5432)      │
                                                │               │
                                                │  Миграции     │
                                                │  через goose  │
                                                └───────────────┘
```

**Compose-сервисы:**

| Сервис    | Что делает                                       |
|-----------|--------------------------------------------------|
| `postgres`| БД, данные в Docker volume                       |
| `migrate` | Применяет goose-миграции и завершается           |
| `api`     | Go HTTP API на порту 8000 (graceful shutdown)    |
| `admin`   | nginx + React SPA на порту 5175                  |

**Backend-пакеты:**

| Пакет                   | Роль                                              |
|-------------------------|---------------------------------------------------|
| `cmd/server`            | main: slog-логгер, pgxpool, запуск goose и сервера|
| `internal/handler`      | HTTP-хендлеры; `NewServer()` регистрирует маршруты|
| `internal/store`        | Репозитории: ComponentStore, LayoutStore, ...     |
| `internal/store/db`     | sqlc-сгенерированный код (Querier, модели)        |
| `internal/auth`         | JWT-утилиты (HS256)                               |
| `internal/exporter`     | layout_json → SVG/HTML                            |
| `internal/svgimport`    | SVG-импорт и классификация                        |
| `migrations`            | SQL-файлы goose, embedded в бинарник              |

---

## Иерархия данных

```
Здание (Office)
  └── Этаж (Floor)
        ├── План (PNG/JPG/SVG) — фон карты
        └── Layout (карта)
              ├── Границы (boundaries)
              ├── Стены (walls)
              ├── Перегородки (partitions)
              ├── Двери (doors)
              └── Объекты (desks)
                    ├── workplace → синхр. в таблицу desks
                    ├── chair     → только на карте
                    ├── plant     → только на карте
                    └── ...другие asset_type
```

---

## Пакет вопросов техлида

### Общие

1. **Как поднимается проект локально?**
   `docker compose up -d --build`; сервисы: `postgres`, `migrate`, `api`, `admin`. Готовность API проверяется через `GET /health`.

2. **Где точки входа?**
   React admin: `http://localhost:5175`; Go API: `http://localhost:8000`; PostgreSQL: `localhost:5432`; Swagger UI: `http://localhost:8000/docs`.

3. **Что является основным продуктовым контуром?**
   Админский редактор карт: здания, этажи, component library, canvas editor, draft/publish, SVG/HTML export, invite-based регистрация. Это НЕ система бронирования — только редактор планировок.

### Авторизация и доступ

4. **Как устроены роли и авторизация?**
   `POST /auth/login` выдаёт HS256 JWT с claims `sub`, `role`, `exp`. Admin-only операции (invites, user management, cleanup) требуют `role=admin`. Все остальные эндпоинты (компоненты, здания, этажи, layout) доступны любому авторизованному пользователю.

5. **Как новые пользователи получают доступ?**
   Админ создаёт invite для конкретного email (`POST /admin/invites`). Пользователь получает ссылку `/?invite=<token>`, регистрируется. Invite одноразовый и может иметь срок действия (`expires_in_hours`).

6. **Откуда берётся первый админ?**
   Из env-переменных `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`. Создаётся автоматически при старте API если в БД нет ни одного админа.

### Данные и схема

7. **Где схема БД и как запускаются миграции?**
   Файлы: `backend-go/migrations/00001_schema.sql`, `00002_templates.sql`, `00003_blocks.sql`. Используется [goose](https://github.com/pressly/goose) с embedded-файлами — применяются автоматически при старте сервера. Compose-сервис `migrate` выполняет миграции до запуска `api`.

8. **Какие API критичны для редактора?**
   `/offices`, `/floors`, `/components`, `/blocks`, `/templates`, `/floors/{id}/layout/*`, `/floors/{id}/lock`, `/render/svg`, `/render/html`, `/admin/invites`, `/desks`.

9. **Как рабочие места попадают в таблицу `desks`?**
   При публикации layout (`POST /layout/publish`) или ручной синхронизации (`POST /layout/sync-desks`). Только объекты с `asset_type=workplace` создают записи. Кресла, растения и прочий декор не попадают.

### Layout workflow

10. **Как устроен draft/publish?**
    ```
    PUT /layout/draft     → создаёт ревизию со статусом draft
    PUT /layout/draft     → обновляет существующий draft
    POST /layout/publish  → draft → published, old published → archived
    DELETE /layout/draft   → отмена черновика
    ```
    Каждая ревизия хранит полный JSON карты. Ничего не теряется.

11. **Что такое оптимистичная блокировка (version)?**
    Каждая ревизия имеет числовое поле `version`. При сохранении draft клиент передаёт текущую version — если она не совпадает с серверной, возвращается `409 Conflict`. Защита от перезаписи чужих правок.

12. **Что такое floor lock?**
    Блокировка этажа (TTL 10 минут) — запрещает другим сохранять draft на этот этаж. Снять может только тот, кто поставил. Истекает автоматически.

13. **Как работают ревизии?**
    `GET /layout/revisions` — список всех ревизий с флагом `is_current`. `POST /layout/revisions/{id}/restore` — создаёт новый draft из любой старой ревизии. `POST /admin/cleanup/revisions?older_than_days=90` — удаляет archived старше N дней.

### Экспорт

14. **Что такое семантический SVG?**
    SVG с `<defs>/<symbol>` для компонентов, слоями (`background`, `structure`, `workplace`), атрибутами `data-building-id`, `data-storey-id`, `data-workplace-id`, `data-inventory-number` и `<use>` ссылками. Готов для парсинга и интеграции.

15. **Что такое HTML-экспорт?**
    Standalone HTML с CSS hover-подсветкой и JavaScript-событием `deskbook:workplace-click`. При клике на рабочее место генерируется `CustomEvent` с `detail: {id, inventory_number, ...}`. Для встраивания в сторонние системы.

### Компоненты

16. **Как устроена библиотека компонентов?**
    Встроенные компоненты (`workplace-desk-chair`, `chair`, `meeting-table` и др.) доступны всегда — hardcoded в Go. Пользовательские создаются через `POST /components` и хранятся в `global_components`. `PUT` на встроенный ID создаёт override в БД.

17. **Какая валидация SVG?**
    `<script>`, `<iframe>`, `<object>`, `<embed>`, `onclick` и прочие XSS-векторы запрещены — возвращается `422 Unprocessable Entity`.

### Редактор карт (Canvas Editor)

18. **Как устроен интерфейс редактора?**
    Canvas editor — SVG-редактор с pan/zoom через viewBox. Инструменты: Select, Pan, Place, Measure, Draw Wall/Partition/Zone/Boundary. Масштаб/Undo/Save — в HUD-оверлее поверх канваса (не в тулбаре). Фоновое изображение управляется через popover-кнопку «Фон» в HUD.

19. **Что такое pixels_per_meter?**
    Масштаб карты: сколько canvas-единиц равно 1 метру. Дефолт — **50** (1 м = 50 ед.). Показывается в статусбаре как «1 м = N ед.» и кликается для редактирования. Сетка адаптируется к масштабу: `niceMetricStep(ppm × zoom)` выбирает ближайший красивый шаг (0.05, 0.1, 0.25, 0.5, 1, 2, 5… метров) чтобы линии были ~40px друг от друга.

### Деплой и обслуживание

20. **Какие проверки обязательны перед релизом?**
    - `cd backend-go && go test ./... -count=1`
    - `cd frontend/admin-react && npm run lint && npm run test && npm run build`
    - Contract tests: `bash tests/go_renderer_contract.sh`, `bash tests/go_components_contract.sh`, `bash tests/go_layout_contract.sh`
    - Smoke test: `bash tests/smoke_test.sh` на поднятом стеке

21. **Как настроить production?**
    ```bash
    bash scripts/gen-secrets.sh   # генерирует .env.production
    cp .env.production .env
    rm -f docker-compose.override.yml  # убрать dev-порты
    docker compose up --build -d
    ```
    Наружу только порт 80 (nginx). PostgreSQL и Go API — только внутри Docker-сети.
    Для HTTPS добавить overlay: `docker compose -f docker-compose.yml -f docker-compose.ssl.yml up -d`

22. **Бэкап и восстановление?**
    ```bash
    bash scripts/backup.sh           # бэкап PostgreSQL (ротация 30 копий)
    bash scripts/restore.sh <file>   # восстановление
    ```

23. **Как работает логирование?**
    API использует `log/slog`. По умолчанию — текстовый формат. Установите `APP_ENV=production` для JSON-логов (удобно для Loki/ELK).

---

## Полезные ссылки

| Ресурс | URL / Путь |
|--------|-----------|
| Swagger UI (интерактивная документация) | `http://localhost:8000/docs` |
| React Admin | `http://localhost:5175` |
| API документация (Markdown) | `docs/API.md` |
| OpenAPI спецификация | `backend-go/openapi.yaml` |
| Схема БД | `backend-go/migrations/00001_schema.sql` |
| Интерактивный онбординг | `bash scripts/onboarding.sh` |
| Smoke test | `bash tests/smoke_test.sh` |

---

## Developer workflow

### Типичный цикл разработки

```bash
# 1. Поднять стек
docker compose up -d --build

# 2. Запустить React dev server с hot reload
cd frontend/admin-react && npm run dev

# 3. Редактировать Go-код, пересобрать API
docker compose up -d --build api

# 4. Прогнать тесты
cd backend-go && go test ./... -count=1

# 5. Frontend lint + тесты
cd frontend/admin-react && npm run lint && npm run test

# 6. Contract tests
bash tests/smoke_test.sh
```

### Добавление нового endpoint

1. Добавить handler в `backend-go/internal/handler/` (файл по домену: `offices_floors.go`, `layouts.go`, ...)
2. Зарегистрировать маршрут в `internal/handler/handler.go`
3. Добавить CRUD-метод в `internal/store/` + SQL в `internal/store/queries/`
4. Обновить OpenAPI спецификацию:
   ```bash
   # Отредактировать backend-go/openapi.yaml
   cp backend-go/openapi.yaml backend-go/internal/handler/swagger-ui/openapi.yaml
   ```
5. Добавить тест в `internal/handler/` (unit) и/или `tests/` (contract)

### Добавление миграции

1. Создать `backend-go/migrations/NNNNN_description.sql` (формат goose)
2. Файл подхватывается автоматически через `embed.FS` в `migrations/migrations.go`
3. `docker compose up -d --build migrate` — применить

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| `GET /health` не отвечает | `docker compose ps` — проверить что `api` running. `docker compose logs api` — посмотреть ошибки |
| `database store disabled` в логах | PostgreSQL не готов — `migrate` мог не успеть. `docker compose restart api` |
| `409 Conflict` при сохранении draft | Версия устарела — перезагрузить layout с сервера и повторить |
| `423 Locked` при сохранении draft | Этаж заблокирован другим — подождать 10 мин или попросить снять |
| `422` при создании компонента | SVG содержит запрещённые теги (`<script>` и т.д.) |
| `403` на admin-эндпоинте | Пользователь не admin — проверить `role` в JWT |
| Swagger UI пустой | `openapi.yaml` не скопирован в `internal/handler/swagger-ui/` |
| Frontend не видит API | Проверить что `api` на порту 8000. Vite proxy: `vite.config.*` → `/api` |
| Go не установлен | Запускать через Docker: `docker run --rm -v "$PWD/backend-go:/app" -w /app golang:1.23-alpine go test ./...` |
| Логи в JSON | Установить `APP_ENV=production` в `.env` |

---

## Live Checklist

Пройти руками или через `bash scripts/onboarding.sh`:

- [ ] Запустить `docker compose up -d --build`
- [ ] Проверить `curl http://localhost:8000/health`
- [ ] Открыть `http://localhost:5175` (React admin)
- [ ] Войти админом (bootstrap credentials из `.env`)
- [ ] Открыть Swagger UI: `http://localhost:8000/docs`
- [ ] Создать invite через «Приглашения»
- [ ] Открыть invite-ссылку, зарегистрировать пользователя
- [ ] Создать здание и этаж
- [ ] Открыть этаж в layout editor
- [ ] Создать компонент в библиотеке
- [ ] Создать layout draft с рабочими местами
- [ ] Опубликовать layout
- [ ] Проверить `published.svg` и `published.html`
- [ ] Убедиться что desks синхронизировались
- [ ] Проверить аудит-лог и ревизии
- [ ] Прогнать `bash tests/smoke_test.sh`
