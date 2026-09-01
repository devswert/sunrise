/**
 * Cuándo dos palabras son **la misma palabra** para el sugeridor del modal de
 * crear (§4.31).
 *
 * Vive aparte porque lo usan las cuatro reglas —tiempo por palabra clave, canal
 * por palabra clave, canal por su nombre y el solape con el objetivo— y porque es
 * lo único de todo esto que se puede probar contra ejemplos concretos:
 * `issue`/`issues`, `review`/`reviwe`.
 *
 * La tolerancia no es un lujo: la lista de palabras la escribe el usuario en
 * Configs, y una lista que hay que llenar con cada plural y cada variante deja de
 * mantenerse a la tercera. Con esto, una palabra por idea alcanza.
 *
 * **Dos piezas, y solo una es nuestra.** La cercanía la mide **Jaro-Winkler**,
 * que es el algoritmo estándar para comparar nombres escritos a mano
 * (deduplicación de registros): devuelve una similitud normalizada entre 0 y 1,
 * con un premio para las que comparten prefijo. Eso importa acá porque el typo
 * casi nunca está en la primera letra — se teclea bien el arranque de la palabra
 * y se resbala después. Antes esto eran tres tramos de distancia de edición
 * elegidos a ojo contra los ejemplos de arriba; el umbral único y publicado vale
 * más que unos números calibrados para pasar nuestros propios tests.
 *
 * La pieza nuestra es el plural, que se resuelve aparte y antes.
 */

/** Sin acentos y en minúsculas: se escribe rápido y con o sin tildes. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Si una es el plural de la otra: `+s` o `+es`, en cualquiera de los dos
 * sentidos.
 *
 * Se pregunta **antes** de medir similitud, y no se deja que lo resuelva la
 * métrica, porque el plural es una certeza y el parecido es una apuesta:
 * `issue`/`issues` tiene que calzar siempre, y no quedar sujeto a que dos letras
 * de diferencia sobre cinco pasen o no pasen el umbral.
 *
 * No intenta ser morfología del español —`lápiz`/`lápices` no entra— porque las
 * palabras que se escriben acá son verbos y sustantivos de trabajo, y estirarlo
 * más solo agrega formas de calzar de casualidad.
 */
function esPluralDe(a: string, b: string): boolean {
  return a === `${b}s` || a === `${b}es`;
}

/**
 * Similitud de **Jaro**: proporción de letras que aparecen en las dos palabras
 * lo bastante cerca, castigada por las que aparecen cambiadas de orden.
 *
 * "Lo bastante cerca" es la ventana de la definición —la mitad de la palabra más
 * larga, menos uno—, y es lo que hace que la métrica sirva para nombres tipeados:
 * una letra corrida un lugar sigue contando, una que aparece en la otra punta no.
 * Devuelve entre 0 (nada en común) y 1 (iguales).
 */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const ventana = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const usadasA = new Array<boolean>(a.length).fill(false);
  const usadasB = new Array<boolean>(b.length).fill(false);

  let comunes = 0;
  for (let i = 0; i < a.length; i++) {
    const desde = Math.max(0, i - ventana);
    const hasta = Math.min(i + ventana + 1, b.length);
    for (let j = desde; j < hasta; j++) {
      if (usadasB[j] || a[i] !== b[j]) continue;
      usadasA[i] = true;
      usadasB[j] = true;
      comunes++;
      break;
    }
  }
  if (comunes === 0) return 0;

  // Las comunes que no salieron en el mismo orden. Se cuentan de a media, que es
  // como está definida la métrica: una transposición son dos letras.
  let traspuestas = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!usadasA[i]) continue;
    while (!usadasB[k]) k++;
    if (a[i] !== b[k]) traspuestas++;
    k++;
  }
  traspuestas /= 2;

  return (comunes / a.length + comunes / b.length + (comunes - traspuestas) / comunes) / 3;
}

/** Hasta cuántas letras de prefijo compartido premia Winkler, y cuánto. */
const PREFIJO_MAX = 4;
const PESO_PREFIJO = 0.1;
/** Winkler solo premia a las que ya se parecen; debajo de esto no toca nada. */
const PISO_PREMIO = 0.7;

/**
 * **Jaro-Winkler**: la similitud de Jaro con el premio por prefijo común.
 *
 * Las constantes son las de la definición (hasta 4 letras, factor 0.1), no
 * elegidas por nosotros.
 */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  if (j < PISO_PREMIO) return j;
  let prefijo = 0;
  while (prefijo < PREFIJO_MAX && a[prefijo] !== undefined && a[prefijo] === b[prefijo]) prefijo++;
  return j + prefijo * PESO_PREFIJO * (1 - j);
}

/**
 * Desde dónde dos palabras son la misma.
 *
 * **0.9 es el corte convencional** de Jaro-Winkler para "esto es la misma cosa
 * escrita distinto", el mismo que se usa para cruzar nombres entre padrones. Se
 * queda en el valor de la literatura a propósito: bajarlo o subirlo para que pase
 * un ejemplo puntual es volver a tener un número que solo se justifica por
 * nuestros tests.
 *
 * Lo que deja adentro y afuera, medido: entran `reviwe`/`review` (0.97),
 * `tikcet`/`tickets` (0.92 — el typo y el plural juntos, sin ayuda) y
 * `sporte`/`soporte` (0.91); quedan afuera `mail`/`mall` (0.87), `docs`/`dock`
 * (0.88), `casa`/`caso` (0.88) y `doc`/`docente` (0.87).
 *
 * Y entra también algún par que son dos palabras distintas de verdad
 * —`revisar`/`revisor`, 0.94—, aceptado a sabiendas: lo que se juega es un chip
 * prellenado que se corrige con un click, contra una función que deja de servir
 * apenas escribes rápido, que es cuando se usa.
 */
const UMBRAL = 0.9;

/**
 * Si las dos palabras son la misma: igual, el mismo singular, o a un typo de
 * distancia. Es la única puerta de entrada; el resto del módulo es su mecánica.
 */
export function mismaPalabra(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return true;
  if (esPluralDe(x, y) || esPluralDe(y, x)) return true;
  return jaroWinkler(x, y) >= UMBRAL;
}

/** Si alguna palabra del texto es la misma que `palabra`. */
export function algunaEs(tokens: readonly string[], palabra: string): boolean {
  return tokens.some((t) => mismaPalabra(t, palabra));
}
