import { HashRouter, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TodayView } from "./features/today/TodayView";
import { WeekView } from "./features/week/WeekView";
import { WeeklyPlanningView } from "./features/planning/WeeklyPlanningView";
import { DailyPlanningView } from "./features/planning/DailyPlanningView";
import { WeeklyReviewView } from "./features/review/WeeklyReviewView";
import { DailyShutdownView } from "./features/shutdown/DailyShutdownView";
import { DailyHighlightsView } from "./features/shutdown/DailyHighlightsView";
import { BacklogView } from "./features/backlog/BacklogView";
import { FocusView } from "./features/focus/FocusView";
import { SettingsView } from "./features/settings/SettingsView";
import { AddTaskModal } from "./features/tasks/AddTaskModal";
import { QuitConfirm, useQuitListener } from "./components/QuitConfirm";
import { WhatsNew } from "./features/updates/WhatsNew";
import { UpdateError } from "./features/updates/UpdateError";
import { useUpdateRuntime } from "./features/updates/useUpdateRuntime";
import { useDevFake } from "./features/updates/devFake";
import { useAppStore, useDataSync } from "./lib/store";
import { useDayWatcher } from "./lib/day";
import { useSettingsRuntime } from "./lib/settings";
import { useFontRuntime } from "./lib/fonts";
import { useShortcuts } from "./lib/shortcuts";
import { useTimerStore } from "./features/timer/timerStore";
import { useTimerRuntime } from "./features/timer/useTimer";
import { useFloatingWindow, useGotoListener } from "./features/timer/useFloatingWindow";
import { useCalendarListener } from "./features/calendar/useCalendarListener";
import { useCalendarSyncRuntime } from "./lib/calendarSync";
import { useShutdownReminder } from "./features/shutdown/useShutdownReminder";
import { useBackupListener } from "./features/backup/useBackupListener";
import { useNoticeNavigation } from "./features/notifications/useNoticeNavigation";
import "./features/week/week.css";
import "./features/updates/updates.css";
import "./features/tasks/task-modal.css";
import "./features/tasks/add-task-modal.css";
import "./components/search-select.css";
import "./components/dialog.css";
import "./features/focus/focus.css";
import "./features/calendar/rail.css";
import "./features/backup/backup.css";

/** Efectos que necesitan estar dentro del Router. */
function Shell({ children }: { children: React.ReactNode }) {
  useTimerRuntime();
  // Recarga las vistas cuando el taxímetro (u otra ventana) muta datos.
  useDataSync();
  useSettingsRuntime();
  // La tipografía elegida, estampada en <html>. Después de los ajustes porque sale
  // de ellos.
  useFontRuntime();
  // Una sesión que queda abierta cruza la medianoche sin enterarse.
  useDayWatcher();
  useShortcuts();
  useQuitListener();
  // OJO: tiene que ser un valor estable. Si se pasa el objeto `display`, su
  // identidad cambia con cada tick del reloj y el efecto llamaría a `show()`
  // una vez por segundo, robando el foco continuamente.
  const taximeterVisible = useTimerStore((s) => !!(s.active || s.last));
  // Y hasta que el timer se haya leído de la base, esta ventana no opina: un
  // timer corriendo no deja rastro en `localStorage`, así que antes de esa
  // lectura "no hay nada" es una respuesta inventada.
  const timerLoaded = useTimerStore((s) => s.loaded);
  useFloatingWindow(taximeterVisible, timerLoaded);
  useGotoListener();
  // El poller de calendario corre en Rust y avisa por evento de Tauri.
  useCalendarListener();
  // Y además se sincroniza al abrir la app y al volver a la ventana, que es
  // cuando de verdad importa que esté al día.
  useCalendarSyncRuntime();
  // Avisa a la hora de `work_end` que toca cerrar el día. Va acá y no en el
  // taxímetro por la misma razón que la campana (I6): una sola ventana avisa.
  useShutdownReminder();
  // El respaldo automático **corre en Rust** (`backup.rs`), igual que la campana:
  // acá solo se escucha su aviso para releer los ajustes que escribió.
  useBackupListener();
  // Los avisos los manda Rust; acá solo se escucha la respuesta para navegar a
  // donde prometían. En `Shell` porque el evento llega a las dos ventanas y el
  // taxímetro no tiene esas vistas.
  useNoticeNavigation();
  // Sondea el updater cada 4 h y detecta si esta sesión viene de actualizarse.
  // También una sola ventana: dos serían dos consultas por intervalo.
  useUpdateRuntime();
  // Banco de pruebas del updater en la consola. Solo en dev; en el build es código
  // muerto. Para sacarlo: borra `devFake.ts` y esta línea.
  useDevFake();
  return <>{children}</>;
}

export default function App() {
  const composeOpen = useAppStore((s) => s.composeOpen);

  return (
    <HashRouter>
      <Shell>
        {/* Sin barra de título, mover la ventana necesita una zona declarada.
         * Cruza todo el borde superior y no solo el sidebar, porque el gesto de
         * arrastrar una ventana se hace donde sea que esté vacío arriba. Tapa
         * exactamente el alto que ya es padding en las dos columnas, así que no
         * se come ningún click. */}
        <div className="app-dragbar" data-tauri-drag-region />
        <div className="app-shell">
          <Sidebar />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<WeekView />} />
              <Route path="/today" element={<TodayView />} />
              <Route path="/focus" element={<FocusView />} />
              <Route path="/daily-planning" element={<DailyPlanningView />} />
              <Route path="/daily-shutdown" element={<DailyShutdownView />} />
              <Route path="/daily-highlights" element={<DailyHighlightsView />} />
              <Route path="/weekly-planning" element={<WeeklyPlanningView />} />
              <Route path="/weekly-review" element={<WeeklyReviewView />} />
              <Route path="/backlog" element={<BacklogView />} />
              <Route path="/settings" element={<SettingsView />} />
            </Routes>
          </main>
        </div>
        {composeOpen && <AddTaskModal />}
        <QuitConfirm />
        <WhatsNew />
        <UpdateError />
      </Shell>
    </HashRouter>
  );
}
