# Registro EMS

Aplicación web instalable de ImpulsaFit para gestionar fichas, sesiones e intensidades de EMS. Al crear una ficha se asignan un código, como `EMS-0001`, y la fecha de alta. Se puede buscar por nombre, móvil o código y filtrar por estado.

Para eliminar un cliente, mantén pulsada su ficha y toca **Eliminar**. El aviso identifica al cliente e indica que también se borrarán todas sus sesiones e intensidades. **Cancelar** conserva sus datos. En ordenador también puedes usar el botón derecho o la tecla **Supr** sobre su nombre. El toque breve sigue abriendo sus intensidades y **Editar** mantiene su función independiente.

Toca la ficha de un cliente para abrir **Intensidades EMS** y anotar el máster y los diez canales de Wiems PRO en mA. Cada sesión tiene fecha y permite registrar los valores por bloque. Fuerza breve, Full body, Core y Metabólico guardan una toma independiente de máster y diez canales por vuelta. La sesión estándar de 35 minutos parte de 3, 4, 4 y 3 vueltas respectivamente; puedes ajustar **Vueltas del bloque** para que coincida con tu rutina. **Vuelta que registras** cambia la toma que estás editando. Activación y Vuelta a la calma mantienen una sola toma. Los registros anteriores se conservan como la primera vuelta, sin repetir sus valores en las demás. Los campos vacíos quedan sin registrar. Escribe `0` cuando quieras anotar 0 mA. Pulsa **Editar** para cambiar los datos del cliente.

**Reset valores** vacía el máster y los canales de la vuelta seleccionada (o la toma única en los otros bloques). Las otras vueltas se conservan. Para reducir el número de vueltas, primero vacía las que quieras quitar. Pulsa **Guardar sesión** para aplicar los cambios o **Cancelar** para descartarlos. Las sesiones sin valores no aparecen en el historial; si vacías todos los bloques de una sesión guardada y guardas el cambio, se retira del historial.

Para eliminar una sesión completa, mantén pulsada su fecha y toca **Eliminar**. Un toque breve abre sus valores. En ordenador también puedes abrir la opción con el botón derecho del ratón o con la tecla **Supr** sobre la fecha. El borrado afecta únicamente a la sesión seleccionada, incluidos todos sus bloques.

Elige el bloque y pulsa **Hacer foto** para abrir la cámara del móvil o **Elegir foto** para usar una imagen guardada. Revisa el recorte propuesto. Puedes arrastrar sobre la imagen para incluir los nombres de los diez canales, los números y el máster de una sola fila. **Foto completa** permite empezar de nuevo y **Ajustar los bordes del recorte** ofrece controles adicionales. Pulsa **Leer valores**. La foto rellena únicamente la vuelta seleccionada y queda visible junto a sus campos durante la edición. Cambiar de vuelta durante la lectura mantiene cada resultado en su vuelta de origen. Revisa los valores, completa los pendientes y pulsa **Guardar sesión**.

Si en la foto aparecen varias filas de valores, selecciona la del cliente. El máster se busca en el círculo azul junto a su foto, independientemente de la lectura de los canales. Su número se separa de la etiqueta pequeña mA y se lee conservando el detalle de la imagen original. Tesseract.js procesa la imagen en el dispositivo, en memoria. Abre la app con conexión la primera vez que uses el lector para descargar su motor y el modelo de texto. La versión instalada aparece junto al nombre Registro EMS.

## Uso e instalación

Abre la URL de GitHub Pages en Chrome, Edge o Safari y usa **Instalar**. En iPhone y iPad, desde Safari usa **Compartir** y **Añadir a pantalla de inicio**. La app funciona sin conexión después de que el navegador guarde sus archivos en la primera visita.

Las fichas y sus sesiones se guardan en el navegador de cada dispositivo. En **Copias** puedes descargar un respaldo JSON y restaurarlo en otro dispositivo. Restaurar una copia sustituye el listado de ese dispositivo. Las copias de seguridad incluyen todas las vueltas y admiten las copias anteriores de la app.

## Desarrollo

Comprueba el registro por vueltas y las copias con `node --test ems-rounds.test.mjs`.

Sirve la raíz del repositorio con un servidor local. Por ejemplo, ejecuta `python -m http.server 8000` y abre `http://localhost:8000`. En GitHub Pages, selecciona **Deploy from a branch**, rama `main` y carpeta `/ (root)`.

- `index.html`, `app.css` y `app.js` definen el listado, los formularios y las acciones.
- `client-store.js` contiene la validación y el almacenamiento en IndexedDB. Cada ficha conserva sus sesiones en `emsSessions`.
- `ems-panel.js` controla el historial y el formulario de intensidades. `ems-sessions.js` define los bloques, los canales y su validación.
- `ems-ocr.js` y `wiems-values.js` leen la foto y alinean los números con los canales de Wiems PRO. Consulta `OCR-LICENSE.txt` para las versiones y licencias del motor.
- `ems-photo.js` prepara la foto y permite ajustar el recorte antes de leerla.
- `manifest.webmanifest` y `sw.js` habilitan la instalación y el acceso sin conexión. Actualiza la versión de caché en `sw.js` al publicar cambios de la app.

Sube al repositorio el código de la app. Conserva tus copias de clientes fuera del repositorio.
