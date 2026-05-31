# Granja Detrás de la Luna

Sitio y tema para [Granja Detrás de la Luna](https://granjadetrasdelaluna.blogspot.com/): landing estática local, scraper de bitácora y plantilla Blogger personalizada.

## Contenido del repositorio

| Ruta | Descripción |
|------|-------------|
| `blogger-theme.xml` | Plantilla Blogger (bitácora por feed Atom, lightbox, vídeos, hero) |
| `index.html` + `app.js` + `site.css` | Vista previa / sitio estático local |
| `scrape_granja.py` | Scraper del blog → JSON + imágenes |
| `scripts/rebuild_blog_json.py` | Reconstruye `granja_blog.json` desde el feed (recomendado) |
| `scripts/apply_video_support.py` | Parches de soporte de vídeo en el XML |
| `granja-hero-upload.jpg` | Hero para subir manualmente a Blogger |

Notas de desarrollo en Cursor (`prompts.md`) quedan solo en tu máquina; no están en este repositorio.

## Requisitos

- Python 3.11+
- [Bun](https://bun.sh) o npm (solo para compilar Tailwind → `site.css`)

## Instalación

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
bun install   # o npm install
bun run build:css
```

## Datos de la bitácora

```bash
# Preferido: feed Atom + imágenes locales existentes
.venv/bin/python scripts/rebuild_blog_json.py

# Scrape completo (más lento; puede fallar si el HTML del tema no expone .post-body)
.venv/bin/python scrape_granja.py
```

`granja_blog.json` e `images/` están en `.gitignore` (generados). Tras generarlos, sirve el sitio local:

```bash
python3 -m http.server 8080
```

## Desplegar en Blogger

1. En Blogger: **Tema → Editar HTML** → pegar todo `blogger-theme.xml` → Guardar.
2. Subir `granja-hero-upload.jpg` en una entrada o como imagen del blog y, si hace falta, ajustar la URL del hero en el XML (o dejar que el feed use la primera foto de la bitácora).
3. Mantener el widget **Blog1** en la sección oculta `main_content` para el botón **Nueva entrada**.

## Vídeos

- **YouTube / Vimeo:** se incrustan en el lightbox con iframe.
- **Vídeos subidos a Blogger (`video.g?token=...`):** el lightbox muestra botón **Reproducir video**; el iframe embebido a menudo falla en Brave/Linux.

### Audio sí, pantalla negra (Linux / Brave)

Síntoma: en `blogger.com/video.g` o en el lightbox se oye audio pero no hay imagen.

**Solución confirmada:** desactivar aceleración por hardware en Brave (`brave://settings/system`) o abrir:

```bash
brave --disable-features=AcceleratedVideoDecodeLinuxGL
```

También funciona en Firefox con la misma opción de rendimiento. Alternativa estable: publicar el vídeo en **YouTube** e insertar el enlace en la entrada.

## Enlaces

- Blog: https://granjadetrasdelaluna.blogspot.com/
- Reservas: https://calendar.app.google/YDDPBgQ76pFZHpHV7

## Repositorio

Código en [godofredosecas-web/granja-detras-luna-blogger](https://github.com/godofredosecas-web/granja-detras-luna-blogger). La carpeta de trabajo es el clon o copia de ese repo; `granja_blog.json` e `images/` se generan localmente (`.gitignore`).
