# ⚽ Mis Láminas · Mundial 2026

App web (PWA) para llevar el control de tu álbum de láminas del Mundial usando la
**cámara del celular**. Escaneas el número impreso de cada lámina con OCR y la app
te arma automáticamente dos listas:

- **Faltantes**: las láminas que aún no tienes.
- **Repetidas**: las que escaneaste más de una vez (las que te sobran para cambiar).

> Pensada para el **Mundial 2026 (FIFA)**. Como el conteo oficial del set aún no
> está cerrado, los rangos de números son **editables** desde la pestaña *Álbum*.

## Cómo funciona

1. **Escanear** 📷 — Abres la cámara, encuadras el número de la lámina dentro del
   recuadro amarillo y tocas *Escanear*. El OCR (Tesseract.js, en el navegador)
   detecta el número; lo confirmas o lo corriges y lo agregas.
   - Si **no la tenías** → entra a tu colección.
   - Si **ya la tenías** → se marca como **repetida** automáticamente.
   - También hay **carga manual** rápida (escribir el número y Enter) por si
     prefieres no usar la cámara o el OCR falla.
2. **Listas** 📋 — Ves *Repetidas*, *Faltantes* (con buscador) y *Tengo*. Puedes
   tocar una lámina para sumar/restar unidades, y **compartir/copiar** el resultado
   (texto listo para WhatsApp).
3. **Álbum** ⚙️ — Defines el set (nombre y secciones con prefijo + rango), y
   **exportas/importas** tu colección como `.json` para respaldarla.

Tus datos se guardan **solo en tu dispositivo** (localStorage). Nada se sube a
ningún servidor.

## Cómo usarla en el celular

La cámara necesita **HTTPS** (o `localhost`). Opciones:

### Opción A — Probarla en tu compu
```bash
# Python 3
python3 -m http.server 8000
# luego abre http://localhost:8000 en el navegador
```
Para usar la cámara desde el celular necesitas HTTPS; lo más fácil es la Opción B.

### Opción B — Publicarla gratis (recomendado para el celular)
Sube esta carpeta a cualquier hosting estático con HTTPS. Por ejemplo
**GitHub Pages**:

1. Sube el repo a GitHub.
2. *Settings → Pages → Build from branch* → elige la rama y carpeta `/root`.
3. Abre la URL `https://<usuario>.github.io/<repo>/` en el celular.
4. En el navegador del celular: menú → **"Agregar a pantalla de inicio"** para
   instalarla como app.

## Estructura

```
index.html            Interfaz (3 pestañas)
css/styles.css        Estilos (mobile-first, modo oscuro)
js/app.js             Lógica de la app y UI
js/store.js           Modelo de datos + localStorage + cálculo de listas
js/camera.js          Cámara + recorte/preprocesado del recuadro
js/ocr.js             OCR con Tesseract.js
manifest.json         Configuración PWA
service-worker.js     Caché offline del app shell
icons/icon.svg        Icono
```

## Notas técnicas

- El **OCR** se hace 100% en el navegador con
  [Tesseract.js](https://github.com/naptha/tesseract.js) (cargado desde CDN). La
  **primera** vez que escaneas necesita conexión para bajar el modelo `eng`;
  después suele quedar cacheado.
- El reconocimiento se enfoca en el **número impreso** de la lámina (no en la foto
  del jugador), que es la señal más fiable. Siempre puedes corregir el número antes
  de agregarlo.
- Para mejorar el OCR, la imagen del recuadro se recorta, se escala y se convierte
  a blanco y negro antes de analizarla.
