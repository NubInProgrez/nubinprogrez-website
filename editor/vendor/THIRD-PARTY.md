# Dependencias de Media Studio

Los binarios originales se distribuyen sin modificaciones.

## @ffmpeg/ffmpeg 0.12.15

- Archivos: `ffmpeg.js`, `814.ffmpeg.js`.
- Licencia MIT. Texto: `LICENSE-ffmpeg-wasm.txt`.
- Proyecto y código fuente: https://github.com/ffmpegwasm/ffmpeg.wasm
- Distribución: https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.15
- Archivos obtenidos de https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/

## @ffmpeg/core 0.12.10

- Archivos: `ffmpeg-core.js`, `ffmpeg-core.wasm`.
- Núcleo de FFmpeg compilado a WebAssembly. Incluye bibliotecas externas y conserva sus licencias; no está cubierto únicamente por la licencia MIT del wrapper.
- Se acompaña el texto GPLv2 en `COPYING.GPLv2.txt`.
- Distribución: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Archivos obtenidos de https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/
- Fuentes, versiones de las bibliotecas y scripts de compilación: https://github.com/ffmpegwasm/ffmpeg.wasm
- FFmpeg y sus licencias: https://ffmpeg.org/legal.html
- Explicación oficial de las licencias del wrapper y del núcleo: https://ffmpegwasm.netlify.app/docs/faq/#what-is-the-license-of-ffmpegwasm

Conserva estos avisos y las licencias de FFmpeg y sus bibliotecas al redistribuir el motor. El código del editor se encuentra en `editor.mjs` y `engine.mjs` y no procede de online-video-cutter.com.
