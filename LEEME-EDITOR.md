# Media Studio de nubinprogrez

El sitio conserva About me, Portfolio, sus recursos y su dominio CNAME. El nuevo enlace **Media Studio** aparece tanto en la pantalla inicial como en la barra de navegación y lleva a `editor/`.

## Publicar en tu sitio actual

1. Descomprime este proyecto.
2. Actualiza `index.html` en tu repositorio o alojamiento y añade **toda** la carpeta `editor/`, incluyendo `vendor/ffmpeg-core.wasm`. Los demás archivos originales se conservan en el ZIP.
3. Usa el mismo procedimiento de publicación que ya utilizas para tu página. No necesitas npm, compilación ni un servidor de procesamiento.
4. Visita tu dominio y entra en Media Studio. También puedes entrar directamente en `/editor/` (o en `/nombre-del-repositorio/editor/` si tu sitio vive en una subcarpeta).

No se publicó ningún cambio en tu alojamiento desde este chat. El ZIP es el proyecto completo listo para subir. Mantén las cuatro dependencias de `editor/vendor/` junto a sus avisos de licencia.

## Probar en tu computadora

Desde la carpeta que contiene `index.html`, ejecuta:

```sh
python -m http.server 8080
```

Abre `http://localhost:8080` en un navegador moderno. También funciona con Live Server de VS Code. **Abrir el HTML con doble clic no funciona**: el editor necesita HTTP o HTTPS para cargar los módulos, el worker y WebAssembly.

## Funciones incluidas

- Carga local por selector o arrastrando un archivo.
- Vista previa de video y reproducción de audio. Forma de onda para audios que el navegador pueda decodificar, de hasta 80 MB.
- Línea de tiempo: reproducción, dos deslizadores de inicio/fin, tiempos en segundos, marcar inicio/fin y repetir selección. Barra espaciadora para reproducir o pausar fuera de los controles.
- Conservar un intervalo o eliminar un intervalo intermedio y unir las partes restantes.
- Recorte de imagen con relaciones original, 1:1, 16:9, 9:16, 4:3 y coordenadas personalizadas en porcentaje.
- Giro a 90/180/270 grados, espejo horizontal/vertical, brillo y contraste.
- Velocidad de 0.25× a 4×, manteniendo el tono del audio mediante `atempo`.
- Volumen de 0 a 200%, silenciar, fundidos de entrada y salida.
- Extracción de audio de videos.
- Unión de hasta diez archivos, con reordenamiento y eliminación de la cola. El primer archivo utiliza su selección de tiempo; los adicionales se incluyen completos. Todos reciben los mismos ajustes de velocidad, imagen y audio. Los videos se normalizan a la resolución del primero y a 30 fps; se añade silencio a los clips sin audio para mantener la sincronización. Para exportar video todos los clips deben contener imagen; para exportar audio todos deben contener audio.
- Salida MP4 (H.264/AAC), WebM (VP8/Vorbis), GIF (12 fps, sin audio), MP3, WAV, M4A y OGG. Selección de calidad y resolución hasta 1080p, 720p o 480p, sin ampliar archivos pequeños.
- Progreso orientativo, cancelación del worker, mensajes de error y descarga del resultado.
- Diseño adaptable a computadora y móvil, manteniendo los colores y la fuente del sitio.

## Funcionamiento y límites

Esta es una implementación propia con funciones similares a la referencia. No contiene código privado, servicios, cuentas ni integraciones de 123apps. No incluye importación desde Google Drive/Dropbox/URL, herramientas de IA, grabación, subtítulos ni un editor de múltiples pistas superpuestas.

El motor FFmpeg se incluye localmente: no se descargan dependencias de edición desde un CDN al usar el sitio. Los archivos de medios no se envían a un servidor. La tipografía sigue utilizando Google Fonts, como el sitio original.

El límite de la interfaz es de 500 MB por archivo y 500 MB en total para una unión. La memoria disponible, la duración, los codecs y la resolución pueden exigir límites menores, especialmente en teléfonos. Para trabajar con archivos de varios GB o exportar con mayor velocidad se necesitaría un backend con FFmpeg nativo y almacenamiento temporal.

La reproducción original depende de los codecs del navegador. Si un formato es reconocido por FFmpeg pero no por el navegador, el editor permite trabajar por tiempo y convertirlo sin vista previa. Los fundidos se aplican en la exportación. La vista previa de volumen está limitada al 100%; el aumento hasta 200% se aplica al archivo exportado. La vista previa de color es aproximada. El progreso del motor también es orientativo.

## Archivos del editor

- `editor/index.html`: interfaz.
- `editor/editor.css`: estilos.
- `editor/editor.mjs`: archivos, reproducción, vista previa y flujo de exportación.
- `editor/engine.mjs`: construcción de filtros y comandos FFmpeg.
- `editor/vendor/`: ffmpeg.wasm 0.12.15 y núcleo 0.12.10, con avisos de terceros.

## Verificación realizada

Se ejecutaron exportaciones reales con el núcleo WASM incluido: corte, eliminación intermedia, recorte cuadrado y personalizado, giro, espejo, velocidad, volumen/fundidos, silencio y los siete formatos. Se comprobaron duración y dimensiones de los resultados y la ausencia de pista de audio al silenciar.

También se verificó la unión a MP4, MP3 y GIF, incluyendo un video sin audio. En el navegador se cargó y descargó un MP4 con un corte de 2 segundos y giro de 90°; el archivo descargado se inspeccionó y confirmó 180 × 320 píxeles, 2 segundos y pistas de video y audio. Estas pruebas usan muestras pequeñas y no garantizan compatibilidad con todos los codecs o tamaños.

Consulta `editor/vendor/THIRD-PARTY.md` para las dependencias y sus licencias.
