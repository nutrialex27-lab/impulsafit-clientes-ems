# Clientes EMS de ImpulsaFit

Aplicación web instalable para dar de alta, buscar y editar clientes. Al crear una ficha se asignan un código, como `EMS-0001`, y la fecha de alta. Se puede buscar por nombre, móvil o código y filtrar por estado.

En la ficha de cada cliente, abre **Intensidades EMS** para anotar el máster y los diez canales de Wiems PRO en mA. Cada sesión tiene fecha y permite registrar los valores por bloque. Los campos vacíos quedan sin registrar. Escribe `0` cuando quieras anotar 0 mA.

## Uso e instalación

Abre la URL de GitHub Pages en Chrome, Edge o Safari y usa **Instalar**. En iPhone y iPad, desde Safari usa **Compartir** y **Añadir a pantalla de inicio**. La app funciona sin conexión después de que el navegador guarde sus archivos en la primera visita.

Las fichas y sus sesiones se guardan en el navegador de cada dispositivo. En **Copias** puedes descargar un respaldo JSON y restaurarlo en otro dispositivo. Restaurar una copia sustituye el listado de ese dispositivo. Se pueden restaurar las copias de la versión anterior de la app.

## Desarrollo

Sirve la raíz del repositorio con un servidor local. Por ejemplo, ejecuta `python -m http.server 8000` y abre `http://localhost:8000`. En GitHub Pages, selecciona **Deploy from a branch**, rama `main` y carpeta `/ (root)`.

- `index.html`, `app.css` y `app.js` definen el listado, los formularios y las acciones.
- `client-store.js` contiene la validación y el almacenamiento en IndexedDB. Cada ficha conserva sus sesiones en `emsSessions`.
- `ems-panel.js` controla el historial y el formulario de intensidades. `ems-sessions.js` define los bloques, los canales y su validación.
- `manifest.webmanifest` y `sw.js` habilitan la instalación y el acceso sin conexión. Actualiza la versión de caché en `sw.js` al publicar cambios de la app.

Sube al repositorio el código de la app. Conserva tus copias de clientes fuera del repositorio.
