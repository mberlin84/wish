# ⚽ Mis Láminas · Mundial 2026

App para llevar el control de tu álbum de láminas del Mundial usando la **cámara
del celular**, con **cuentas de usuario** y **trueque por cercanía**.

- 📷 Escaneas el número impreso de cada lámina (OCR en el navegador).
- ❌ **Faltantes** / ♻️ **Repetidas** se calculan solos.
- 👤 Tu colección queda **asociada a tu usuario** (guardada en el servidor).
- 📍 Compartes tu **ubicación** (GPS o ciudad) y la app te muestra **con quién
  hacer trueque cerca de ti**: quién tiene lo que te falta y a quién le sirven tus
  repetidas.

> Pensada para el **Mundial 2026 (FIFA)**. El set es **editable** porque el conteo
> oficial aún no está cerrado.

## Arquitectura

```
Frontend (PWA, estático)            Backend (Node + Express)         Base de datos
  index.html / css / js     <--->     /api/...                <--->   PostgreSQL
  - cámara + OCR (Tesseract.js)        - auth (JWT + bcrypt)           - users
  - colección y listas                 - colección por usuario         - stickers
  - trueque                            - emparejador de trueques       - album_sections
```

- Sin sesión funciona en **modo invitado** (datos solo en el dispositivo).
- Con sesión, la colección vive en **PostgreSQL** y se habilita el **trueque**.
- El backend también sirve la PWA, así que puedes desplegar todo junto.

## Puesta en marcha

### 1) Base de datos
Necesitas un PostgreSQL (local o en la nube). Crea una base de datos vacía, por
ejemplo `mislaminas`.

### 2) Backend
```bash
cd server
cp .env.example .env        # edita DATABASE_URL y JWT_SECRET
npm install
npm run migrate             # crea las tablas y siembra el set 2026
npm start                   # arranca en http://localhost:3000
```
Abre `http://localhost:3000` (el servidor sirve la app y la API juntas).

Variables de entorno (`server/.env`):

| Variable        | Descripción                                              |
|-----------------|----------------------------------------------------------|
| `DATABASE_URL`  | Cadena de conexión a PostgreSQL                          |
| `DATABASE_SSL`  | `true` si tu Postgres requiere SSL (nube)                |
| `JWT_SECRET`    | Secreto para firmar las sesiones (cámbialo)              |
| `PORT`          | Puerto del servidor (def. 3000)                          |
| `ALBUM_NAME`    | Nombre del álbum mostrado en la app                      |

### 3) Frontend separado (opcional)
Si prefieres servir la PWA aparte (p. ej. GitHub Pages) y el backend en otra URL,
abre la app, ve a **Cuenta → Servidor** y escribe la URL del backend
(ej. `https://mi-backend.com`). El CORS ya está habilitado.

> La **cámara** y el **GPS** requieren **HTTPS** (o `localhost`). Para usarlos
> desde el celular, despliega el backend con HTTPS o usa un túnel (p. ej. la app
> tras un proxy con certificado).

## API

| Método | Ruta                     | Auth | Descripción                              |
|--------|--------------------------|------|------------------------------------------|
| POST   | `/api/auth/register`     | —    | Crear cuenta (email, usuario, contraseña)|
| POST   | `/api/auth/login`        | —    | Iniciar sesión → token JWT               |
| GET    | `/api/me`                | ✓    | Datos del usuario                        |
| PUT    | `/api/me/location`       | ✓    | Guardar `lat`, `lng`, `city`             |
| GET    | `/api/album`             | —    | Definición del set (global)              |
| PUT    | `/api/album`             | ✓    | Reemplazar secciones del set             |
| GET    | `/api/collection`        | ✓    | Colección del usuario `{code: count}`    |
| POST   | `/api/collection/add`    | ✓    | +1 a una lámina (repetida si ya existe)  |
| POST   | `/api/collection/remove` | ✓    | −1 a una lámina                          |
| POST   | `/api/collection/set`    | ✓    | Fijar cantidad exacta (0 = eliminar)     |
| GET    | `/api/trades`            | ✓    | Trueques posibles, ordenados por cercanía|
| GET    | `/api/messages/conversations` | ✓ | Lista de chats (último mensaje + no leídos) |
| GET    | `/api/messages/unread-count`  | ✓ | Total de mensajes sin leer (badge)      |
| GET    | `/api/messages/with/:userId`  | ✓ | Conversación con un usuario (marca leídos)|
| POST   | `/api/messages/with/:userId`  | ✓ | Enviar un mensaje a un usuario          |

### Cómo se calcula el trueque
Para tu usuario, el backend cruza tu colección con la de los demás:
- **Te puede dar**: láminas que el otro tiene **repetidas** y a ti **te faltan**.
- **Tú le puedes dar**: tus **repetidas** que al otro **le faltan**.

Se priorizan los **trueques mutuos** y se ordenan por **distancia** (haversine
sobre las coordenadas) y por número de coincidencias.

## Uso de la app

1. **📷 Escanear** — Activas la cámara, encuadras el número en el recuadro y tocas
   *Escanear*. Confirmas/corriges el número y lo agregas. Hay carga manual también.
2. **📋 Listas** — *Repetidas*, *Faltantes* (con buscador) y *Tengo*; compartir/copiar.
3. **🤝 Trueque** — *Buscar trueques cerca* (requiere sesión). Cada coincidencia
   tiene un botón **💬 Chatear** para escribirle a esa persona.
4. **💬 Chat** — Conversaciones con otras personas para coordinar el trueque. Los
   mensajes nuevos se reciben por sondeo (cada 5 s) y hay un contador de no leídos.
5. **👤 Cuenta** — Crear cuenta / iniciar sesión, guardar ubicación (GPS o ciudad),
   configurar el álbum y exportar/importar tus datos locales.

## Estructura

```
index.html, css/, js/        Frontend PWA
  js/api.js                  Cliente del backend (token + fetch)
  js/store.js                Modelo local + cálculo de listas
  js/camera.js, js/ocr.js    Cámara y OCR
  js/app.js                  Lógica y UI
manifest.json, service-worker.js, icons/   PWA

server/                      Backend
  src/index.js               App Express (API + estáticos)
  src/db.js, src/migrate.js  Conexión y migración a PostgreSQL
  src/auth.js                JWT
  src/routes/                auth, me, album, collection, trades, messages
  db/schema.sql              Esquema + semilla del set 2026
```

## Notas

- El **OCR** corre 100% en el navegador con
  [Tesseract.js](https://github.com/naptha/tesseract.js); la primera vez baja el
  modelo `eng` desde CDN (necesita conexión esa vez).
- Las contraseñas se guardan con **bcrypt**; las sesiones usan **JWT** (30 días).
- La ubicación es **opcional**: sin ella, el trueque igual encuentra coincidencias,
  solo que no las ordena por cercanía.
