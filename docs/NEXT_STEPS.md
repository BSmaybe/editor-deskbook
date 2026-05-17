# Следующие Шаги И Проверки

Документ отражает текущий editor-only контур после переноса сервисов в Go + React.

## Готово

- Один Go API вместо старого набора backend/renderer сервисов.
- Одна React admin точка входа на `http://localhost:5175`.
- CRUD зданий (`/offices`) и этажей (`/floors`) в API.
- UI-раздел Buildings для создания, редактирования, удаления и выбора этажей.
- Component library CRUD.
- Layout draft/publish/import/export workflow.
- Frozen placeholders для бронирований, политик, аналитики и клиентских модулей.

## Ближайший Фокус

1. **Полировка building/floor UX**
   - Подтвердить реальные названия сущностей: `office` как здание или офисная локация.
   - Добавить сортировку этажей по бизнес-номеру, если `id` недостаточно.

2. **Layout editor**
   - Проверить сценарии импорта реальных SVG планов.
   - Уточнить обязательные поля workplace объектов: inventory number, workplace id, zone.

3. **Production readiness**
   - Зафиксировать backup/rollback для PostgreSQL.
   - Настроить production `SECRET_KEY` и `ADMIN_REGISTER_SECRET`.
   - Определить политику очистки тестовых пользователей и временных ревизий.

4. **Замороженные модули**
   - Решить, удаляются ли booking/client routes полностью или остаются 501 compatibility placeholders.
   - После решения обновить roadmap и API contracts.

## Проверять Перед Релизом

```bash
cd backend-go && go test ./...
cd ../frontend/admin-react && npm run build
cd ../..
bash tests/go_renderer_contract.sh
bash tests/go_components_contract.sh
bash tests/go_layout_contract.sh
bash tests/smoke_test.sh
```

Если локального Go нет, backend-тест можно прогнать через Docker:

```bash
docker run --rm -v "$PWD/backend-go:/src" -w /src golang:1.23-alpine go test ./...
```
