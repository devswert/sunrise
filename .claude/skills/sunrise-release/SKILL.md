---
name: sunrise-release
description: Publica una versión de sunrise — escribe la entrada del changelog, sube la versión en los tres archivos, commitea y empuja el tag que dispara el Release en GitHub. Úsala cuando el usuario quiera sacar una versión, publicar un update, subir el número de versión, avisarle al equipo de algo nuevo, o cuando pregunte cómo se publica un release. También cuando haya que corregir un release fallido (retaguear) o cuando el modal "Lo nuevo" muestre el texto equivocado.
---

# Publicar una versión de sunrise

Publicar es **un tag**. El resto lo hace `.github/workflows/release.yml`: compila
en `macos-14`, corre las dos suites, firma con la llave del updater y publica el
`.dmg`, el `.app.tar.gz`, su `.sig` y el `latest.json`.

**El único gatillo es empujar un tag `v*`.** No hay disparo manual del workflow, y
eso es a propósito: corrido desde una rama, el `tagName` valdría `main` y
publicaría un Release llamado "sunrise main".

## El texto se escribe una vez y se lee en tres lugares

De la sección de `docs/CHANGELOG.md` salen los tres textos que ve el equipo, y por
eso **no se escriben por separado**:

| Dónde | Qué parte |
|---|---|
| Modal "Lo nuevo en la vX.Y.Z", al abrir después de actualizar | el **primer párrafo** |
| Configs → Actualizaciones, *antes* de instalar | la sección entera (vía `latest.json`) |
| El cuerpo del Release en GitHub | la sección entera |

Que el modal y el aviso previo digan lo mismo es la razón de todo el diseño: si
fueran dos textos, se prometería una cosa y se anunciaría otra, y nadie lo notaría
hasta que ya está publicado.

**El anuncio (primer párrafo) responde una sola pregunta: ¿me conviene
actualizar?** Dos o tres frases, en lenguaje de persona. El detalle técnico va
abajo, en `### Detalle`, y no llega al modal.

## Los pasos

1. **Working tree limpio y en `main`.** Si hay cambios sin commitear, pregunta qué
   hacer con ellos antes de seguir; no los arrastres al commit de versión.
2. **`pnpm test:all` en verde.** Un `.dmg` publicado con tests rojos es peor que no
   publicar: alguien lo instala. Y si el cambio toca fechas, horas o zonas, corre
   además `TZ=UTC pnpm test:rust`: **CI corre en UTC** y ahí aparecen los supuestos
   de zona que en Santiago pasan por casualidad. Así falló el primer tag de la 0.1.0
   (ROADMAP 5.5).
3. **Decide el número.** Semver, y **mayor que el publicado** o las apps
   instaladas no van a ver nada. `git tag --list` dice cuál fue el último.
4. **Pídele al usuario el anuncio.** No lo inventes solo: es el texto que lee todo
   el equipo. Propón un borrador a partir de los commits desde el último tag
   (`git log --oneline <ultimo-tag>..HEAD`) y que él lo corrija. El detalle sí
   puedes armarlo tú desde esos commits.
5. **Escribe la sección** al principio de `docs/CHANGELOG.md`, arriba de la
   anterior, con este formato exacto —lo lee un `awk` en CI y un parser en
   `src/lib/changelog.ts`—:

   ```markdown
   ## v0.2.0 — 2026-09-01

   El párrafo del anuncio, dos o tres frases.

   ### Detalle

   - Lo que cambió, una línea por cosa
   ```

   La fecha va en la zona del usuario, no en UTC.
6. **Sube la versión en los tres archivos**: `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`, `package.json`. Tienen que decir lo mismo; hay dos
   tests que lo vigilan (`la_version_es_semver_y_coincide_en_los_tres_archivos` en
   Rust, y en `src/lib/changelog.test.ts` que la versión tenga su anuncio escrito).
7. **`pnpm test:all` otra vez**, que ahora también valida el changelog.
8. **Commit** (`chore: versión 0.2.0`) y **empuja**, y recién después el tag:

   ```bash
   git push && git tag v0.2.0 && git push origin v0.2.0
   ```

   El tag después del push: si el tag llega primero, CI compila un commit que el
   remoto todavía no tiene.
9. **Mira la corrida** (`gh run watch`) y cuando termine **comprueba que el Release
   tenga los cuatro archivos** (`gh release view v0.2.0`). Si falta el
   `latest.json` o el `.sig`, el `.dmg` sirve para instalar pero el auto-update no
   funciona, y el síntoma es el silencioso: "nunca hay actualizaciones".

## Si algo sale mal

**Un tag no se mueve.** Si CI falla o el Release sale incompleto, borra los dos y
vuelve a taguear el commit corregido. Si CI falló **antes** del paso que publica no
hay Release que borrar, solo el tag:

```bash
gh release delete v0.2.0 --yes && git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0
```

Mover un tag que alguien ya bajó deja dos binarios distintos con el mismo número,
y el `latest.json` apuntando a uno de ellos. Si ya lo instaló alguien del equipo,
**no lo muevas**: saca una versión nueva.

## Lo que esta skill no hace

- **No firma con Apple Developer.** Decisión tomada: el bundle se firma **ad-hoc**
  (`signingIdentity: "-"`), que no evita el bloqueo de Gatekeeper pero lo deja
  levantable; la primera instalación pide `xattr -cr /Applications/sunrise.app` y
  está escrito en el README. Detalle y el modo de falla en SPECS §4.19.
- **No toca la llave privada del updater.** Vive en los secrets del repo. Si falta,
  los artefactos salen sin firmar y las apps los rechazan sin decir por qué.
- **No decide el número por ti.** Un cambio que rompe datos o una migración que no
  se puede deshacer merece minor, no patch.
