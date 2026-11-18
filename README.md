# Registro EMS

Aplicación web instalable de ImpulsaFit para gestionar fichas, sesiones e intensidades de EMS. Al crear una ficha se asignan un código, como `EMS-0001`, y la fecha de alta. Se puede buscar por nombre, móvil o código y filtrar por estado.

Toca la ficha de un cliente para abrir **Intensidades EMS** y anotar el máster y los diez canales de Wiems PRO en mA. Cada sesión tiene fecha y permite registrar los valores por bloque. Los campos vacíos quedan sin registrar. Escribe `0` cuando quieras anotar 0 mA. Pulsa **Editar** para cambiar los datos del cliente.

Elige el bloque y pulsa **Escanear con cámara**. Permite el acceso a la cámara y encuadra los canales con sus valores en mA y el máster de Wiems PRO. Pulsa **Leer intensidades**. Si aparecen varias filas, selecciona la del cliente. Revisa los valores antes de pulsar **Guardar sesión**. El lector de Tesseract.js procesa el fotograma en el dispositivo, en memoria. Abre la app con conexión la primera vez que uses el lector para descargar su motor y el modelo de texto.

## Uso e instalación

Abre la URL de GitHub Pages en Chrome, Edge o Safari y usa **Instalar**. En iPhone y iPad, desde Safari usa **Compartir** y **Añadir a pantalla de inicio**. La app funciona sin conexión después de que el navegador guarde sus archivos en la primera visita.

Las fichas y sus sesiones se guardan en el navegador de cada dispositivo. En **Copias** puedes descargar un respaldo JSON y restaurarlo en otro dispositivo. Restaurar una copia sustituye el listado de ese dispositivo. Se pueden restaurar las copias de la versión anterior de la app.

## Desarrollo

Sirve la raíz del repositorio con un servidor local. Por ejemplo, ejecuta `python -m http.server 8000` y abre `http://localhost:8000`. En GitHub Pages, selecciona **Deploy from a branch**, rama `main` y carpeta `/ (root)`.

- `index.html`, `app.css` y `app.js` definen el listado, los formularios y las acciones.
- `client-store.js` contiene la validación y el almacenamiento en IndexedDB. Cada ficha conserva sus sesiones en `emsSessions`.
- `ems-panel.js` controla el historial y el formulario de intensidades. `ems-sessions.js` define los bloques, los canales y su validación.
- `ems-ocr.js` y `wiems-values.js` leen el fotograma de la cámara y alinean los números con los canales de Wiems PRO. Consulta `OCR-LICENSE.txt` para las versiones y licencias del motor.
- `manifest.webmanifest` y `sw.js` habilitan la instalación y el acceso sin conexión. Actualiza la versión de caché en `sw.js` al publicar cambios de la app.

Sube al repositorio el código de la app. Conserva tus copias de clientes fuera del repositorio.
