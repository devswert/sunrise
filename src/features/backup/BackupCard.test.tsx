import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackupCard } from "./BackupCard";
import { SettingKey, backupSettings, useSettingsStore } from "../../lib/settings";

const CARPETA = "/Users/leo/Drive/sunrise";

/**
 * El mock guarda los ajustes en estado de módulo, así que cada test parte de la
 * carpeta que necesita en vez de heredar la del anterior.
 */
async function configurar(dir: string) {
  await useSettingsStore.getState().set(SettingKey.BACKUP_DIR, dir);
  await useSettingsStore.getState().set(SettingKey.BACKUP_LAST_ERROR, "");
}

const guardados = () => backupSettings(useSettingsStore.getState().values);

describe("BackupCard · la carpeta", () => {
  beforeEach(async () => {
    await configurar("");
  });

  it("sin carpeta, dice que el respaldo está apagado y no deja respaldar", async () => {
    render(<BackupCard />);

    expect(await screen.findByText(/Sin carpeta no hay respaldo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Respaldar ahora/ })).toBeDisabled();
  });

  /**
   * La validación al **escribir** es la que importa: `backupSettings` ya cae a
   * "apagado" con basura, pero una carpeta que se acepta y falla nueve horas
   * después no da forma de saber qué se escribió mal.
   */
  it("una ruta que no sirve se rechaza y se dice, en vez de guardarse en silencio", async () => {
    render(<BackupCard />);
    const campo = await screen.findByLabelText("Carpeta de respaldos");

    await userEvent.type(campo, "respaldos");
    await userEvent.tab();

    expect(campo).toHaveClass("is-invalid");
    expect(screen.getByText(/absoluta/)).toBeInTheDocument();
    expect(guardados().dir).toBe("");
  });

  it("guarda una carpeta válida y con eso enciende el respaldo", async () => {
    render(<BackupCard />);
    const campo = await screen.findByLabelText("Carpeta de respaldos");

    await userEvent.type(campo, CARPETA);
    await userEvent.tab();

    expect(guardados().dir).toBe(CARPETA);
    expect(guardados().activo).toBe(true);
  });

  it("vaciar el campo apaga el respaldo sin pedir validación", async () => {
    await configurar(CARPETA);
    render(<BackupCard />);
    const campo = await screen.findByLabelText("Carpeta de respaldos");

    await userEvent.clear(campo);
    await userEvent.tab();

    expect(guardados().activo).toBe(false);
    expect(campo).not.toHaveClass("is-invalid");
  });
});

describe("BackupCard · respaldar", () => {
  beforeEach(async () => {
    await configurar(CARPETA);
  });

  /**
   * Se cuentan las filas antes y después en vez de buscar una sola: el mock
   * guarda los respaldos en estado de módulo, así que la lista arrastra los que
   * hicieron los tests anteriores del archivo.
   */
  it("el respaldo manual aparece en la lista", async () => {
    render(<BackupCard />);
    await screen.findByRole("button", { name: /Respaldar ahora/ });
    const antes = screen.queryAllByRole("button", { name: /Restaurar el respaldo del/ }).length;

    await userEvent.click(screen.getByRole("button", { name: /Respaldar ahora/ }));

    expect(await screen.findByText(/Respaldo listo/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Restaurar el respaldo del/ }),
    ).toHaveLength(antes + 1);
  });

  /**
   * La lección de Mej.16, aplicada acá: un respaldo que dejó de correr en
   * silencio es peor que no tener respaldo, porque se cuenta con él.
   */
  it("muestra el error del último respaldo automático", async () => {
    await useSettingsStore
      .getState()
      .set(SettingKey.BACKUP_LAST_ERROR, "no se puede escribir en /Volumes/backup");
    render(<BackupCard />);

    expect(
      await screen.findByText(/El último respaldo automático falló/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\/Volumes\/backup/)).toBeInTheDocument();
  });

  it("un respaldo manual exitoso limpia el error viejo: ya no describe nada", async () => {
    await useSettingsStore.getState().set(SettingKey.BACKUP_LAST_ERROR, "falló anoche");
    render(<BackupCard />);

    await userEvent.click(await screen.findByRole("button", { name: /Respaldar ahora/ }));
    await screen.findByText(/Respaldo listo/);

    expect(useSettingsStore.getState().values[SettingKey.BACKUP_LAST_ERROR]).toBe("");
  });

  it("un `conservar` menor que 1 se rechaza: no puede ser 'borra todos'", async () => {
    render(<BackupCard />);
    const campo = await screen.findByLabelText("Conservar");

    await userEvent.clear(campo);
    await userEvent.type(campo, "0");
    await userEvent.tab();

    expect(campo).toHaveClass("is-invalid");
    expect(guardados().conservar).toBe(2);
  });
});

describe("BackupCard · restaurar", () => {
  beforeEach(async () => {
    await configurar(CARPETA);
  });

  /** El recién hecho, que `crearBackup` deja primero en la lista. */
  async function abrirElMasNuevo() {
    await userEvent.click(await screen.findByRole("button", { name: /Respaldar ahora/ }));
    const filas = await screen.findAllByRole("button", { name: /Restaurar el respaldo del/ });
    await userEvent.click(filas[0]);
  }

  /** Es la única acción de la app que destruye datos sin poder deshacerse. */
  it("no restaura sin pasar por la confirmación", async () => {
    render(<BackupCard />);
    await abrirElMasNuevo();

    const dialogo = await screen.findByRole("alertdialog", { name: "Confirmar restauración" });
    // Tiene que decir las dos cosas que el usuario necesita saber.
    expect(dialogo).toHaveTextContent(/no se pueden recuperar/);
    expect(dialogo).toHaveTextContent(/guarda una copia de tu base actual/);

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /**
   * El resultado va en su propio diálogo y no en un aviso que se va solo: es la
   * única acción de la app que no se puede deshacer desde la app.
   */
  it("confirmando, cierra la confirmación y abre el resumen de lo que quedó", async () => {
    render(<BackupCard />);
    await abrirElMasNuevo();
    await userEvent.click(await screen.findByRole("button", { name: /Restaurar y reemplazar/ }));

    const resumen = await screen.findByRole("alertdialog", { name: "Respaldo restaurado" });
    // Las tres cosas útiles: de qué momento es, con qué quedó, y el deshacer.
    expect(resumen).toHaveTextContent(/Del/);
    expect(resumen).toHaveTextContent(/tareas?/);
    expect(resumen).toHaveTextContent(/antes-de-restaurar/);
    // Y no la versión, que en el mock es la misma: decir "dev → dev" es ruido.
    expect(resumen).not.toHaveTextContent(/migrado a/);

    await userEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
