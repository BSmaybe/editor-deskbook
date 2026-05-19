# DeskBook API

Base URL: `http://localhost:8000` (Docker) или через nginx proxy `http://localhost:5175/api`.

## Общие правила

- **Content-Type**: `application/json` (кроме login и upload).
- **Auth**: Bearer JWT в заголовке `Authorization: Bearer <token>`.
- **Роли**: `admin` и `user`. Оба имеют полный доступ к редактору (компоненты, здания, этажи, layout, блоки, шаблоны, десков). Admin-only: управление приглашениями (`/admin/invites`), пользователями (`/admin/users`) и cleanup ревизий.
- **Ошибки**: `{"detail": "описание ошибки"}`.
- **HTTP-коды**: `200` OK, `201` Created, `204` No Content, `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not Found, `409` Conflict, `410` Gone, `422` Unprocessable Entity, `423` Locked.

---

## Health

### `GET /health`
Проверка доступности сервиса.

**Auth**: нет  
**Response** `200`:
```json
{"message": "ok"}
```

---

## Auth

### `POST /auth/login`
Получение JWT-токена.

**Auth**: нет  
**Content-Type**: `application/x-www-form-urlencoded` или `application/json`

**Body** (form):
| Поле | Тип | Обязательно |
|------|-----|-------------|
| username | string | да |
| password | string | да |

**Response** `200`:
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

Токен содержит claims: `sub` (username), `role` (admin/user), `exp` (unix timestamp). Алгоритм HS256, секрет из `SECRET_KEY`.

**Ошибки**: `401` неверные credentials, `403` аккаунт деактивирован.

### `POST /auth/register`
Регистрация нового пользователя по invite-ссылке.

**Auth**: нет  
**Body**:
```json
{
  "username": "ivan",
  "email": "ivan@company.com",
  "password": "SecurePass1!",
  "invite_token": "abc123..."
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| username | string | да | Уникальный логин |
| email | string | да | Должен совпадать с email в invite |
| password | string | да | Пароль |
| invite_token | string | да | Токен из invite-ссылки |

**Response** `201`: объект пользователя (без пароля).  
**Ошибки**: `400` пустые поля, `403` невалидный/использованный/просроченный invite или email не совпадает, `409` username или email уже заняты.

---

## Invites (управление приглашениями)

### `POST /admin/invites`
Создать invite для регистрации.

**Auth**: admin  
**Body**:
```json
{
  "email": "user@company.com",
  "role": "user",
  "expires_in_hours": 48
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| email | string | да | Email для регистрации |
| role | string | нет | `admin` или `user` (по умолчанию `user`) |
| expires_in_hours | int | нет | Срок действия в часах (null = бессрочно) |

**Response** `201`: объект invite с полем `token`.  
Ссылка для пользователя: `http://<host>/?invite=<token>`.

### `GET /admin/invites`
Список всех invite.

**Auth**: admin  
**Response** `200`: массив invite-объектов. Каждый содержит: `id`, `token`, `email`, `role`, `created_by`, `created_at`, `expires_at`, `used_at`.

### `DELETE /admin/invites/{invite_id}`
Удалить invite.

**Auth**: admin  
**Response** `204`.

### `GET /invites/{token}`
Публичная информация об invite (для страницы регистрации).

**Auth**: нет  
**Response** `200`:
```json
{
  "email": "user@company.com",
  "role": "user"
}
```
**Ошибки**: `404` не найден, `410` использован или просрочен.

---

## Users (пользователи)

### `GET /users/me`
Текущий пользователь.

**Auth**: любой  
**Response** `200`: объект пользователя.

### `GET /users`
Список пользователей (публичные поля).

**Auth**: любой  
**Query**: `?search=имя` — фильтр по username/full_name.  
**Response** `200`: массив пользователей.

### `GET /admin/users`
Полный список пользователей (admin).

**Auth**: admin  
**Response** `200`: массив пользователей.

### `PATCH /admin/users/{username}`
Обновить роль/статус пользователя.

**Auth**: admin  
**Body**:
```json
{
  "role": "admin",
  "is_active": true
}
```
Оба поля опциональны. **Response** `200`: обновлённый пользователь.

### `DELETE /admin/users/{username}`
Удалить пользователя.

**Auth**: admin  
**Response** `204`.

**Поля пользователя**: `id`, `username`, `email`, `role`, `full_name`, `department`, `position`, `phone`, `user_status`, `is_active`, `created_at`.

---

## Offices (здания)

### `GET /offices`
Список зданий.

**Auth**: нет  
**Response** `200`: `[{"id": 1, "name": "HQ", "address": "ул. Примерная, 1"}]`

### `POST /offices`
Создать здание.

**Auth**: авторизованный  
**Body**: `{"name": "HQ", "address": "ул. Примерная, 1"}`  
**Response** `201`.

### `PATCH /offices/{office_id}`
Обновить здание.

**Auth**: авторизованный  
**Body**: `{"name": "HQ Updated", "address": "новый адрес"}` (все поля опциональны)  
**Response** `200`.

### `DELETE /offices/{office_id}`
Удалить здание.

**Auth**: авторизованный  
**Response** `204`.

---

## Floors (этажи)

### `GET /floors`
Список этажей.

**Auth**: нет  
**Query**: `?office_id=1` — фильтр по зданию.  
**Response** `200`: `[{"id": 1, "office_id": 1, "name": "Этаж 3", "plan_url": "/static/floor_1_plan.png"}]`

### `POST /floors`
Создать этаж.

**Auth**: авторизованный  
**Body**: `{"office_id": 1, "name": "Этаж 3"}`  
**Response** `201`.

### `PATCH /floors/{floor_id}`
Обновить этаж.

**Auth**: авторизованный  
**Body**: `{"name": "Этаж 3 (обновлён)"}`  
**Response** `200`.

### `DELETE /floors/{floor_id}`
Удалить этаж.

**Auth**: авторизованный  
**Response** `204`.

### `POST /floors/{floor_id}/plan`
Загрузить план этажа (PNG/JPG/SVG).

**Auth**: авторизованный  
**Content-Type**: `multipart/form-data`  
**Body**: поле `file` — файл изображения (до 10 МБ).  
**Response** `200`: `{"plan_url": "/static/floor_1_plan.png"}`

---

## Components (библиотека компонентов)

Компоненты — переиспользуемые визуальные элементы карты (стол, кресло, переговорная и т.д.).

### `GET /components`
Список всех компонентов.

**Auth**: нет  
**Response** `200`: массив компонентов.

### `POST /components`
Создать компонент.

**Auth**: авторизованный  
**Body**:
```json
{
  "id": "standing-desk",
  "label": "Standing Desk",
  "asset_type": "workplace",
  "view_box": [0, 0, 120, 60],
  "default_w": 120,
  "default_h": 60,
  "svg_markup": "<rect .../>"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| id | string | Уникальный ID (`^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$`) |
| label | string | Название (до 120 символов) |
| asset_type | string | Тип: `workplace`, `chair`, `desk`, `meeting_table`, `conference_set`, `call_room`, `lounge`, `sofa`, `plant`, `storage`, `printer`, `reception`, `column`, `asset` |
| view_box | [4]float | SVG viewBox |
| default_w | float | Ширина по умолчанию |
| default_h | float | Высота по умолчанию |
| svg_markup | string | SVG-разметка (валидируется, `<script>` запрещён) |

**Response** `201`.  
**Ошибки**: `409` ID уже существует, `422` невалидный SVG.

### `PUT /components/{component_id}`
Обновить компонент (upsert).

**Auth**: авторизованный  
**Body**: такой же как POST. Поле `id` в body должно совпадать с `component_id` из URL.  
**Response** `200`.

### `DELETE /components/{component_id}`
Удалить компонент.

**Auth**: авторизованный  
**Response** `200`: `{"message": "deleted"}`.

---

## Blocks (блоки для layout)

Блоки — группы объектов, которые можно вставить на карту целиком (набор столов, переговорная зона).

### `GET /blocks`
Список блоков.

**Auth**: нет  
**Response** `200`: массив блоков.

### `POST /blocks`
Создать блок.

**Auth**: авторизованный  
**Body**:
```json
{
  "name": "Зона переговорной",
  "category": "meeting",
  "description": "4 стола + 8 кресел",
  "objects": [...],
  "preview_svg": "<svg>...</svg>"
}
```
**Response** `201`.

### `DELETE /blocks/{block_id}`
Удалить блок.

**Auth**: авторизованный  
**Response** `204`.

---

## Templates (шаблоны layout)

Шаблоны — готовые layout-конфигурации для быстрого старта.

### `GET /templates`
Список шаблонов.

**Auth**: нет  
**Response** `200`: массив шаблонов.

### `POST /templates`
Создать шаблон.

**Auth**: авторизованный  
**Body**:
```json
{
  "name": "Open space 50 мест",
  "description": "Типовая планировка",
  "category": "office",
  "layout": { ... }
}
```
**Response** `201`.

### `DELETE /templates/{template_id}`
Удалить шаблон.

**Auth**: авторизованный  
**Response** `204`.

---

## Layout (редактирование карт)

### `GET /floors/{floor_id}/layout`
Текущее состояние layout (draft если есть, иначе published).

**Auth**: любой  
**Response** `200`:
```json
{
  "floor_id": 1,
  "version": 3,
  "status": "draft",
  "layout": { ... },
  "updated_at": "2025-05-19T12:00:00Z",
  "updated_by": "admin"
}
```

### `PUT /floors/{floor_id}/layout/draft`
Сохранить черновик.

**Auth**: авторизованный  
**Body**:
```json
{
  "version": 3,
  "layout": {
    "v": 2,
    "vb": [0, 0, 1000, 600],
    "building_id": "hq",
    "storey_id": "3",
    "zone_id": "main",
    "components": [],
    "boundaries": [],
    "walls": [],
    "partitions": [],
    "doors": [],
    "desks": [...]
  }
}
```
`version` — оптимистичная блокировка, должен совпадать с текущим. **Response** `200`.  
**Ошибки**: `409` version mismatch, `423` этаж заблокирован другим пользователем.

### `DELETE /floors/{floor_id}/layout/draft`
Отменить черновик.

**Auth**: авторизованный  
**Response** `200`.

### `POST /floors/{floor_id}/layout/publish`
Опубликовать черновик.

**Auth**: авторизованный  
**Response** `200`. Автоматически синхронизирует workplace-объекты в таблицу `desks`.

### `POST /floors/{floor_id}/layout/import`
Импортировать SVG и классифицировать элементы.

**Auth**: авторизованный  
**Content-Type**: `text/xml` или `image/svg+xml`  
**Body**: SVG-документ.  
**Response** `200`: результат классификации (стены, двери, рабочие места и т.д.).

### `POST /floors/{floor_id}/layout/sync-desks`
Синхронизировать рабочие места из layout в таблицу desks.

**Auth**: авторизованный  
**Query**: `?source=published&cleanup=false`  
**Response** `200`: `{"created": 5, "updated": 2, "removed": 0, "protected": 0}`.

### `GET /floors/{floor_id}/layout/published`
Опубликованный layout (JSON).

**Auth**: любой  
**Response** `200`.

### `GET /floors/{floor_id}/layout/published.svg`
Опубликованный layout в формате SVG.

**Auth**: любой  
**Response** `200` `image/svg+xml`. Семантический SVG с `<defs>/<symbol>`, `data-*` атрибутами, слоями background/structure/workplace.

### `GET /floors/{floor_id}/layout/published.html`
Опубликованный layout в формате HTML.

**Auth**: любой  
**Response** `200` `text/html`. Standalone HTML с hover CSS и событием `deskbook:workplace-click`.

### `GET /floors/{floor_id}/layout/history`
Аудит-лог изменений layout.

**Auth**: авторизованный  
**Response** `200`: массив записей `{action, username, created_at}`.

### `GET /floors/{floor_id}/layout/revisions`
Список ревизий layout.

**Auth**: авторизованный  
**Response** `200`: массив ревизий с `is_current` флагом.

### `GET /floors/{floor_id}/layout/revisions/{revision_id}`
Получить конкретную ревизию.

**Auth**: авторизованный  
**Response** `200`: layout из ревизии.

### `POST /floors/{floor_id}/layout/revisions/{revision_id}/restore`
Восстановить ревизию как новый черновик.

**Auth**: авторизованный  
**Response** `200`.

---

## Floor Lock (блокировка этажа)

Предотвращает одновременное редактирование. TTL блокировки — 10 минут.

### `GET /floors/{floor_id}/lock`
Текущее состояние блокировки.

**Auth**: любой  
**Response** `200`:
```json
{"locked": true, "locked_by": "admin", "locked_at": "2025-05-19T12:00:00Z"}
```
или `{"locked": false}`.

### `POST /floors/{floor_id}/lock`
Заблокировать этаж.

**Auth**: авторизованный  
**Response** `200`: `{"locked": true, "locked_by": "admin", ...}`.  
**Ошибки**: `423` этаж уже заблокирован другим пользователем.

### `DELETE /floors/{floor_id}/lock`
Снять блокировку.

**Auth**: авторизованный (только владелец блокировки)  
**Response** `200`.

---

## Desks (рабочие места)

Рабочие места синхронизируются из layout при публикации. Только объекты с `asset_type=workplace` создают записи в `desks`.

### `GET /desks`
Список рабочих мест.

**Auth**: нет  
**Query**: `?floor_id=1` — фильтр по этажу.  
**Response** `200`: массив десков.

**Поля**: `id`, `floor_id`, `label`, `type` (`flex`/`fixed`), `space_type`, `assigned_to`, `position_x`, `position_y`, `w`, `h`, `qr_token`.

### `GET /desks/{desk_id}`
Получить рабочее место.

**Auth**: нет  
**Response** `200`.

### `PATCH /desks/{desk_id}`
Обновить рабочее место.

**Auth**: авторизованный  
**Body**: любые поля из `label`, `type`, `space_type`, `assigned_to`, `position_x`, `position_y`, `w`, `h` (все опциональны).  
**Response** `200`.

### `DELETE /desks/{desk_id}`
Удалить рабочее место.

**Auth**: авторизованный  
**Response** `204`.

---

## Render (экспорт)

### `POST /render/svg`
Отрендерить layout в SVG.

**Auth**: нет  
**Body**: `layout_json` напрямую или `{"layout": {...}, "title": "..."}`.  
**Response** `200` `image/svg+xml`.

### `POST /render/html`
Отрендерить layout в HTML.

**Auth**: нет  
**Body**: такой же как `/render/svg`. Можно передать `title` в body или `?title=` query.  
**Response** `200` `text/html`.

---

## Embed (публичный виджет)

### `GET /embed/floors/{floor_id}`
HTML-страница с опубликованной картой этажа для встраивания через iframe.

**Auth**: нет  
**Response** `200` `text/html`.

---

## Admin Maintenance

### `POST /admin/cleanup/revisions`
Удалить архивные ревизии старше N дней.

**Auth**: admin  
**Query**: `?older_than_days=90` (по умолчанию 90).  
**Response** `200`: `{"deleted": 12}`.

---

## Bootstrap

При первом запуске, если в БД нет ни одного admin-пользователя, сервис автоматически создаёт его из переменных окружения:

| Переменная | Описание |
|------------|----------|
| `BOOTSTRAP_ADMIN_USERNAME` | Логин (по умолчанию `admin`) |
| `BOOTSTRAP_ADMIN_EMAIL` | Email |
| `BOOTSTRAP_ADMIN_PASSWORD` | Пароль |

После создания первого админа через UI можно создавать invite и регистрировать остальных пользователей.
