FROM golang:1.23-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /out/deskbook-api ./cmd/server

FROM alpine:3.20

WORKDIR /app
COPY --from=build /out/deskbook-api /app/deskbook-api
EXPOSE 8080
CMD ["/app/deskbook-api"]
