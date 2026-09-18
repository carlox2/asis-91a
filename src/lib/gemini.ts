import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export const GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Identifica a la materia y sirve como anclaje en la UI
 * (panel de Configuración muestra este string).
 *
 * Materia: Neuropsicología (NPS) · Cód. 91 · Cátedra Politis
 * Facultad de Psicología, UBA.
 */
export const ASSISTANT_LABEL =
  "Asistente 91a — Neuropsicología (NPS, Cód. 91, Cátedra Politis — UBA Psicología)";

/**
 * Bibliografía de la materia. El modelo NO debe responder con nada
 * que no esté en estos PDFs. Se suben a Gemini File API una sola vez
 * por sesión y se referencian por fileUri.
 *
 * Vacío = la app funciona en modo "Gemini genérico por voz" (sin
 * base de conocimiento específica). Cuando llenes esta lista, copiá
 * los PDFs adentro de `public/` y registralos acá.
 */
const VITE_BASE_URL: string =
  ((import.meta as ImportMeta & { env: Record<string, string | undefined> }).env?.BASE_URL ?? "/");

const PDF_SOURCES: ReadonlyArray<{ name: string; path: string }> = [
  { name: "01.NPS_1P.pdf", path: `${VITE_BASE_URL}01.NPS_1P.pdf` },
  { name: "02.NPS_2P.pdf", path: `${VITE_BASE_URL}02.NPS_2P.pdf` },
] as const;

/**
 * Cache en localStorage: para cada PDF guardamos { uri, expiry }.
 * TTL: 24h (la File API de Gemini expira a las 48h, dejamos margen).
 */
const KB_CACHE_PREFIX = "gem-pdf-uri:";
const KB_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedUri {
  uri: string;
  expiry: number;
}

function readCachedUri(name: string): string | null {
  try {
    const raw = localStorage.getItem(KB_CACHE_PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUri;
    if (!parsed?.uri || !parsed?.expiry) return null;
    if (parsed.expiry < Date.now()) return null;
    return parsed.uri;
  } catch {
    return null;
  }
}

function writeCachedUri(name: string, uri: string): void {
  try {
    const payload: CachedUri = { uri, expiry: Date.now() + KB_TTL_MS };
    localStorage.setItem(KB_CACHE_PREFIX + name, JSON.stringify(payload));
  } catch {
    /* sin persistencia: se re-subirá cada vez */
  }
}

/**
 * Sube un PDF a Gemini File API y devuelve el fileUri.
 * Si ya hay uno cacheado en localStorage (no expirado), lo reusa.
 */
async function ensurePdfUploaded(
  ai: GoogleGenAI,
  name: string,
  path: string
): Promise<string> {
  const cached = readCachedUri(name);
  if (cached) return cached;

  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`No se pudo cargar ${name} desde el sitio (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error(`El archivo ${name} está vacío.`);
  }

  const uploaded = await ai.files.upload({
    file: new File([blob], name, { type: "application/pdf" }),
    config: { displayName: name },
  });
  const uri = uploaded?.uri;
  if (!uri) {
    throw new Error(`No se pudo subir ${name} a Gemini File API.`);
  }
  writeCachedUri(name, uri);
  return uri;
}

/**
 * Prepara la base de conocimiento: sube los PDFs declarados en
 * `PDF_SOURCES` a Gemini File API (o reutiliza los URIs cacheados)
 * y devuelve un array de `fileData` listo para meter en `parts[]`.
 *
 * Si `PDF_SOURCES` está vacío, devuelve un array vacío sin subir
 * nada. La app sigue funcionando: Gemini responde con su conocimiento
 * general (sin KB específica).
 */
async function buildKnowledgeBaseParts(
  ai: GoogleGenAI,
  onProgress?: (msg: string) => void
): Promise<{ fileData: { fileUri: string; mimeType: string } }[]> {
  if (PDF_SOURCES.length === 0) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.debug("[gem] PDF_SOURCES vacío: respondiendo sin base de conocimiento.");
    }
    return [];
  }
  const parts: { fileData: { fileUri: string; mimeType: string } }[] = [];
  for (const src of PDF_SOURCES) {
    onProgress?.(`Subiendo ${src.name} a Gemini…`);
    const uri = await ensurePdfUploaded(ai, src.name, src.path);
    parts.push({ fileData: { fileUri: uri, mimeType: "application/pdf" } });
  }
  return parts;
}

/**
 * Prompt del sistema — Experto Tutor Académico de Neuropsicología
 * (Cátedra Politis, UBA).
 * IMPORTANTE: el prompt usa markdown (** , - , etc.) para legibilidad
 * humana en el panel de configuración. El TTS puede leer literal los
 * asteriscos; si molesta, se filtran antes de enviar a speechSynthesis.
 */
export const SYSTEM_PROMPT = `**System Prompt / Instrucciones del Sistema**

**Experto Tutor Académico - Neuropsicología (Cátedra Politis - UBA)**

**Identidad y Rol**

Eres un Tutor Experto y Jefe de Trabajos Prácticos de la materia "Neuropsicología" (Código 91, Cátedra Prof. Dr. Daniel Gustavo Politis) para la carrera de Licenciatura en Psicología de la Universidad de Buenos Aires (UBA). Tu rol fundamental y prioritario es ser un especialista infalible en la resolución de preguntas de opción múltiple (Multiple Choice) y en la clarificación conceptual de la arquitectura cognitiva, la semiología neuropsicológica, los modelos teóricos y las herramientas de evaluación y rehabilitación.

**Contexto y Base de Datos**

El estudiante se prepara para rendir dos exámenes parciales presenciales de modalidad Multiple Choice. Tus fuentes exclusivas de conocimiento provienen de los documentos de la cátedra:

- **01.NPS_1P.pdf**: Contenidos de las Unidades 1 a 5 (Introducción, Agnosias, Apraxias, Memoria y Amnesia, Rehabilitación).
- **02.NPS_2P.pdf**: Contenidos de las Unidades 6 a 10 (Conocimiento Semántico, Síndrome Disejecutivo, Cognición Social/ToM, TEA, Demencias).

Los exámenes evalúan aplicación clínica mediante viñetas de casos, doble disociación de funciones, diagnóstico diferencial de síndromes, identificación de tipos de errores práxicos/gnósicos y selección/interpretación de pruebas neuropsicológicas específicas. Las preguntas incluyen de 4 a 5 opciones (a hasta e), con distractores basados en confusiones teóricas frecuentes.

**Corazón Central y Núcleo Teórico de la Cátedra Politis**

Toda respuesta debe articularse conceptualmente desde el marco de la Neuropsicología Cognitiva:

- **Enfoque Cognitivo y Modularidad**: La mente como un sistema de procesamiento de información compuesto por módulos procesadores independientes. Uso del método de caso único, análisis de errores y disociaciones (simples y dobles disociaciones) para inferir la arquitectura mental normal a partir de la patología.
- **Dicotomía Procesamiento Ventral vs. Dorsal**:
  - Vía Ventral ("Qué"): Procesamiento visual para el reconocimiento de objetos y rostros (Agnosias visuales: perceptivas vs. asociativas).
  - Vía Dorsal ("Cómo/Dónde"): Procesamiento visuoespacial y guión de la acción motora voluntaria (Apraxias y trastornos atencionales/espaciales).
- **Modelos Cognitivos Específicos**:
  - **Gnosias**: Modelos de Lissauer, Marr, Ellis y Young.
  - **Praxias**: Modelo clásico de Liepmann, modelo cognitivo de Rothi, Ochipa y Heilman, modelo de Buxbaum.
  - **Memoria**: Distinción entre memoria de trabajo (Baddeley) y sistemas declarativo/no declarativo (Squire).
  - **Semántica**: Modelos de almacenamiento semántico y acceso, hubs semánticos.
  - **Funciones Ejecutivas y Cognición Social**: Control inhibitorio, memoria de trabajo, planificación, Teoría de la Mente (ToM), procesamiento emocional y conducta social (corteza prefrontal dorsolateral, orbitofrontal y ventromedial).

**Ejes Temáticos, Autores y Contenidos por Unidad**

- **UNIDAD 1: Introducción a la Neuropsicología**  
  Neuropsicología clásica vs. cognitiva. Modularidad de la mente. Estudios de grupo vs. caso único. Asociaciones y disociaciones.  
  *Autores Clave*: Escera, C.; Drake, M.; Ellis, A. & Young, A.

- **UNIDAD 2: Agnosias**  
  Concepto de gnosis. Modelos de reconocimiento visual (Lissauer: aperceptiva vs. asociativa; Marr; Ellis y Young). Agnosia táctil, auditiva y prosopagnosia. Negligencia espacial unilateral. Vía Ventral.  
  *Autores Clave*: Chávez, S. et al.; Ellis, A. & Young, A.; Tabernero, E. & Politis, D.G.

- **UNIDAD 3: Apraxias**  
  Neuropsicología del movimiento voluntario. Apraxia ideomotora e ideatoria. Modelos teóricos: Liepmann, Rothi, Ochipa & Heilman, Buxbaum. Clasificación de errores próximos. Vía Dorsal.  
  *Autores Clave*: Politis, D. & Rubinstein, W.; Buxbaum, L. J.

- **UNIDAD 4: Memoria y Amnesia**  
  Procesos y sistemas de memoria (declarativa, semántica, episódica, de trabajo, procedimental). Síndromes amnésicos: amnesia anterógrada vs. retrógrada. Ley de Ribot. Etiologías.  
  *Autores Clave*: Ustárroz, T. & Grandi, F.; Pinel, J.; Harris, P.; Fontán, L.

- **UNIDAD 5: Rehabilitación en Neuropsicología**  
  Principios de rehabilitación cognitiva. Restauración, compensación, sustitución y uso de prótesis cognitivas. Diseño de programas de intervención en daño cerebral.  
  *Autores Clave*: Muñoz Céspedes, J.M. & Tirapu Ustárroz, J.; Fernández-Guinea, S.; Mateer, C.

- **UNIDAD 6: Conocimiento Semántico**  
  Memoria semántica. Modelos de organización semántica. Demencia semántica vs. afasia óptica/anomia semántica. Bases neurobiológicas.  
  *Autores Clave*: Peraita, H. & Moreno, F.J.; Patterson, K.; Cuitiño, M.M.; Martínez-Cuitiño, M.M. & Jaichenco, V.I.

- **UNIDAD 7: Síndrome Disejecutivo**  
  Funciones ejecutivas (planificación, flexibilidad, inhibición, memoria de trabajo). Lóbulo frontal y circuitos frontosubcorticales. Trastornos disejecutivos en enfermedades neurológicas y psiquiátricas.  
  *Autores Clave*: Gómez Beldarrain, M.; Pineda, D.; Verdejo-García, A. & Bechara, A.

- **UNIDAD 8: Cognición Social y Teoría de la Mente (ToM)**  
  Componentes de la cognición social. Teoría de la Mente (primer y segundo orden). Procesamiento emocional. Alteraciones en demencia frontotemporal (variante conductual) y lesiones prefrontales.  
  *Autores Clave*: Tirapu-Ustárroz, J. et al.; Moyano, P.

- **UNIDAD 9: Trastorno del Espectro Autista (TEA)**  
  Criterios diagnósticos DSM-5. Teorías explicativas (coherencia central, función ejecutiva, ToM). Instrumentos de evaluación (IDEA, CHAT, ADI-R, ADOS).  
  *Autores Clave*: APA (DSM-5); Grañana, N.; Rivière, A.

- **UNIDAD 10: Demencias y Deterioro Cognitivo Leve (DCL)**  
  Concepto de DCL. Diagnóstico diferencial de demencias: Enfermedad de Alzheimer, Demencia Vascular, Demencia Frontotemporal (FTD), Demencia por Cuerpos de Lewy. Pruebas de screening (MMSE, ADAS-Cog).  
  *Autores Clave*: Arizaga, R.L.; Allegri, R.F. et al.; Genovese, O.; Mangone, C.A.

**Habilidades y Funciones Principales**

- **Resolución Directa y Justificada (Modo Profesor - Resolución MC)**: Ante la consulta o consigna de un ejercicio, brindarás la opción correcta de forma inmediata, seguida de la justificación teórica basada estrictamente en los modelos teóricos de la cátedra.
- **Análisis Crítico de Opciones**: Explicarás en detalle por qué la opción seleccionada es la correcta y por qué cada uno de los distractores es falso o incorrecto (p. ej., indicando si corresponde a otra patología, a un componente distinto del modelo o a un error conceptual).
- **Generación de Simulacros de Examen**: A solicitud explícita del estudiante, redactarás bloques de evaluación tipo Multiple Choice emulando el nivel de exigencia, el lenguaje técnico de la UBA y las viñetas clínicas típicas.

**Reglas y Restricciones (Strict Mode)**

- **REGLA 1 (Aislamiento de Conocimiento)**: Basa TODAS tus respuestas, resoluciones y explicaciones EXCLUSIVAMENTE en el contenido del programa de la Cátedra Politis. No utilices clasificaciones ni modelos neuropsicológicos externos no contemplados en la bibliografía oficial.
- **REGLA 2 (Límites del Programa)**: Si el usuario realiza una consulta ajena a los temas evaluados (p. ej., neuroanatomía clínica detallada no funcional, técnicas de neuroimagen avanzadas o tratamientos farmacológicos), rechaza la consulta respondiendo: "Como tutor, me ciño estrictamente al programa de Neuropsicología de la Cátedra Politis. Ese tema excede los contenidos evaluados en la materia."
- **REGLA 3 (Formato de Práctica)**: Cuando generes simulacros (solo a pedido explícito), presenta SIEMPRE bloques de 3 a 5 preguntas de opción múltiple con 5 opciones cada una (opciones de la "a" a la "e"). Incluye casos clínicos sintéticos, perfiles de desempeño en tests neuropsicológicos o pares de síntomas.
- **REGLA 4 (Invisibilidad de la Estructura Temática)**: Identifica internamente el módulo o unidad correspondiente para articular tu razonamiento, pero NUNCA menciones de forma explícita el número o nombre de la unidad temática en tu respuesta al estudiante.
- **REGLA 5 (Cero Cortesías)**: No incluyas saludos iniciales ("Hola", "Bienvenido") ni despedidas informales. Ve directo a la respuesta o resolución.
- **REGLA 6 (Prohibido Extenderse)**: No desgloses los distractores uno por uno. No agregues justificaciones teóricas en párrafos separados.
- **REGLA 7 (Prohibido Agregar Preguntas al Final)**: NO generes preguntas adicionales, simulacros no solicitados, ni frases de cierre como "¿Deseas responder estas preguntas...?".
- **REGLA 8 (Simulacros Sólo a Pedido)**: Únicamente generarás preguntas si el usuario pide explícitamente "Deseo un simulacro" o "Genera preguntas". Si solo te pasa una pregunta o caso para resolver, entrégale únicamente la solución en el formato indicado.

**Formato de Respuesta**

Para resolución de preguntas de Multiple Choice o dudas teóricas, responde exclusivamente con este formato breve y directo:

1. **Opción correcta**: [Número y texto de la opción]  
2. **Por qué las otras son incorrectas**: [Una sola oración explicando de forma global por qué se descartan los distractores]

No agregues introducciones, conclusiones ni explicaciones largas.`;

/**
 * Nota legible sobre qué hay cargado como base de conocimiento.
 * Sólo se usa en logs / debug; el modelo la ignora.
 */
export const KNOWLEDGE_BASE_NOTE =
  "Base de conocimiento: pendiente de carga (ver PDF_SOURCES en src/lib/gemini.ts).";

/**
 * Lee la API key desde la variable de entorno de Vite.
 * Se mantiene como fallback; la app prefiere siempre la key que el usuario
 * haya guardado en el panel de Configuración (localStorage).
 */
export const GEMINI_API_KEY: string = (
  (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env?.VITE_GEMINI_API_KEY ?? ""
).trim();


export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "audio/webm";
}

/**
 * Convierte un Blob (audio grabado) a una cadena Base64 *sin* el prefijo
 * `data:<mime>;base64,` que agrega FileReader — es lo que espera Gemini
 * en `inlineData.data`.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("No se pudo codificar el audio a Base64."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Limpia el texto que devuelve Gemini antes de mostrarlo o leerlo en voz
 * alta. Caza los artefactos típicos de cuando el modelo se "contagia" del
 * formato de transcripción de audio (timecodes SRT/VTT, etiquetas de
 * hablante, etc.) y de cualquier residuo de markdown que el TTS leería
 * literal (asteriscos, guiones bajos, etc.). Pensada como red de seguridad:
 * aunque el system prompt lo prohíba, el modelo a veces los emite igual.
 *
 * Patrones que elimina:
 *  - Sello MM:SS o HH:MM:SS pegado o suelto:           00:05 · 1:23 · 00:05.123
 *  - Pegado a una palabra (sin espacio):                "socio01:03estructural" → "socioestructural"
 *  - Con corchetes / ángulos / paréntesis:              [00:05] · <00:05> · (00:05)
 *  - Rangos SRT/VTT:                                    00:05 --> 00:08 · 00:05,000 --> 00:08,000
 *  - Etiquetas de hablante:                             Speaker 1: · Hablante 2:
 *  - Líneas que son solo un número (índices SRT)
 *  - Marcado Markdown simple: **negrita**, *itálica*, _itálica_, `código`
 */
export function sanitizeResponseText(text: string): string {
  if (!text) return text;
  let t = text;
  // 1) Índices de bloque SRT: una línea entera que es solo 1-4 dígitos
  t = t.replace(/^\s*\d{1,4}\s*$/gm, "");
  // 2) Rangos SRT/VTT: "00:05 --> 00:08" / "00:05,000 --> 00:08,000"
  t = t.replace(
    /\b\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\b/g,
    " "
  );
  // 3) Sellos de tiempo con corchetes/ángulos/paréntesis: [00:05], <1:23>
  t = t.replace(
    /[\[\<\(]\s*\b\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\b\s*[\]\>\)]/g,
    " "
  );
  // 4) Sellos sueltos: 00:05, 1:23, 00:05.123 (incluye HH:MM:SS).
  //    Importante: NO usar \b al final, porque un sello pegado a una
  //    palabra ("socio01:03estructural") no tiene word boundary y el
  //    \b lo dejaría pasar. Usamos (?<!\d) al inicio (para no
  //    comernos el "12" de "12:00:30") y (?!\d) al final (para no
  //    comernos el "00" de "12:00:30.5"). El reemplazo es "" (sin
  //    espacio) para que el texto fluya al pegarse a la palabra.
  t = t.replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?(?!\d)/g, "");
  // 5) Etiquetas de hablante: "Speaker 1:", "Hablante 2]", "Speaker1 -"
  t = t.replace(/\b(?:Speaker|Hablante|Unknown)\s*\d+\s*[:\-\]]\s*/gi, " ");
  // 6) Markdown residual: negrita (**), itálica (*) y código (`).
  //    El system prompt prohíbe markdown, pero a veces el modelo se
  //    "contagia" y lo emite igual — y speechSynthesis lo lee literal
  //    ("asterisco asterisco negrita asterisco asterisco").
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  t = t.replace(/`([^`]+)`/g, "$1");
  // 6.5) Guiones largos / rayas (—, –) y secuencias de guiones
  //      enfáticos. El system prompt los prohíbe, pero el modelo
  //      a veces los emite como pausas dramáticas. speechSynthesis
  //      los lee literal ("guión guión guión..."). Los borramos como
  //      red de seguridad antes de la limpieza final.
  t = t.replace(/[—–]+/g, " ");
  // 7) Limpieza: colapsa espacios y saltos de línea sobrantes
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Extrae un mensaje legible de un error arbitrario (incluido el del SDK). */
function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as {
      message?: string;
      status?: number | string;
      code?: number | string;
      error?: { message?: string; code?: number | string; status?: string };
    };
    if (e.error?.message) {
      const code = e.error.code ?? e.error.status ?? e.status ?? e.code;
      return code ? `[${code}] ${e.error.message}` : e.error.message;
    }
    if (e.message) return e.message;
  }
  return "Error desconocido al hablar con Gemini.";
}

/**
 * Detecta errores transitorios del servicio (503 UNAVAILABLE,
 * "high demand", "overloaded", etc.). En esos casos, reintentamos
 * una vez antes de mostrar el error al usuario.
 */
function isTransientError(err: unknown): boolean {
  const detail = describeError(err).toLowerCase();
  return (
    detail.includes("503") ||
    detail.includes("unavailable") ||
    detail.includes("high demand") ||
    detail.includes("overloaded") ||
    detail.includes("try again later")
  );
}

/**
 * Sube los PDFs de la bibliografía a Gemini File API (o reutiliza
 * los URIs cacheados en localStorage). Es idempotente: si el cache
 * expiró o nunca existió, sube; si todavía es válido, no hace nada.
 *
 * Útil para "calentar" la base de conocimiento al inicio de la sesión
 * y para que la UI pueda mostrar el estado ("Subiendo PDFs a Gemini…").
 */
export async function warmupKnowledgeBase(
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const cleanKey = apiKey.trim();
  if (!cleanKey || cleanKey === "TU_API_KEY_AQUI") {
    throw new Error("Configura tu API Key de Gemini en el panel de Configuración.");
  }
  const ai = new GoogleGenAI({ apiKey: cleanKey });
  await buildKnowledgeBaseParts(ai, onProgress);
}

/**
 * Indica si la base de conocimiento ya está cacheada y vigente.
 * Devuelve true si AMBOS PDFs tienen un fileUri no expirado.
 */
export function isKnowledgeBaseReady(): boolean {
  return PDF_SOURCES.every((s) => readCachedUri(s.name) !== null);
}

/**
 * Envía el audio + la base de conocimiento (PDFs vía File API) a Gemini
 * usando el SDK oficial `@google/genai`.
 *
 * Estructura del request:
 *   parts: [
 *     ...pdfFileData[],              // todos los PDFs declarados en PDF_SOURCES
 *     { inlineData: <audio> },       // clip grabado
 *     { text: <instrucción> }        // "Escuchá el audio y respondé…"
 *   ]
 *
 * Manejo de errores:
 *  - Errores transitorios (503/UNAVAILABLE/"high demand"): reintenta una
 *    vez con 4 s de espera. Si el segundo intento también falla, muestra
 *    un mensaje claro en español.
 *  - API key inválida / 401/403: mensaje específico, sin reintento.
 *  - Cuota agotada / 429: mensaje específico, sin reintento.
 *  - Errores de red: mensaje específico, sin reintento.
 */
export async function askGemini(
  base64Audio: string,
  mimeType: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey || cleanKey === "TU_API_KEY_AQUI") {
    throw new Error("Configura tu API Key de Gemini en el panel de Configuración.");
  }

  const ai = new GoogleGenAI({ apiKey: cleanKey });

  // 1) Base de conocimiento: sube los PDFs a File API (o reusa cache).
  onProgress?.("Preparando base de conocimiento…");
  const pdfParts = await buildKnowledgeBaseParts(ai, onProgress);

  const contents = [
    {
      parts: [
        ...pdfParts,
        { inlineData: { mimeType, data: base64Audio } },
        {
          text:
            "Escuchá el audio adjunto y respondé según las instrucciones del sistema. " +
            "Tu respuesta debe fundamentarse exclusivamente en los PDFs cargados " +
            "como base de conocimiento (ver PDF_SOURCES en src/lib/gemini.ts). " +
            "Extensión obligatoria: entre 200 y 250 palabras, en prosa continua, " +
            "sin saludos, sin listas y sin cuadros.",
        },
      ],
    },
  ];
  const config = {
    systemInstruction: SYSTEM_PROMPT,
    // 4096 tokens: en Gemini 3, los tokens de thinking cuentan contra
    // maxOutputTokens. Con este margen, el modelo tiene aire para
    // pensar (poco) y responder las 200-250 palabras que exige el
    // system prompt sin cortarse.
    maxOutputTokens: 4096,
    // Thinking MINIMAL = mínimo gasto de tokens en razonamiento
    // previo, deja el grueso del budget para la respuesta visible.
    // Con LOW se comía ~2300 tokens y dejaba la respuesta en ~100.
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    // Temperatura baja = respuestas más deterministas y ligeramente
    // más rápidas (menos sampling).
    temperature: 0.3,
  };

  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config,
      });
      const text = (response?.text ?? "").trim();
      if (!text) {
        throw new Error("Gemini no devolvió texto. Intenta grabar la pregunta con más claridad.");
      }
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
        // Espera 4 s antes del reintento.
        await new Promise((resolve) => setTimeout(resolve, 4000));
        continue;
      }
      break;
    }
  }

  // Si llegamos acá, falló definitivamente. Mapeo a un mensaje en
  // español claro, sin JSON crudo en la UI.
  const detail = describeError(lastErr);
  const lower = detail.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("auth") ||
    lower.includes("credential") ||
    lower.includes("permission") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    throw new Error(`API Key rechazada por Gemini: ${detail}`);
  }
  if (lower.includes("quota") || lower.includes("429") || lower.includes("rate")) {
    throw new Error(`Cuota o rate-limit de Gemini: ${detail}`);
  }
  if (isTransientError(lastErr)) {
    throw new Error(
      "El servicio de Gemini está saturado. Reintentá en unos minutos. " +
        `Detalle: ${detail}`
    );
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econn") || lower.includes("timeout")) {
    throw new Error(`Sin conexión con Gemini: ${detail}`);
  }
  throw new Error(`Gemini rechazó la solicitud: ${detail}`);
}

/**
 * Transcribe LITERALMENTE el audio a texto (español rioplatense).
 *
 * Se usa SOLO para el log automático de Q&A (qa-logs/): corre en segundo
 * plano DESPUÉS de que la respuesta académica ya se mostró y leyó, así no
 * suma latencia a la UX. Llamada liviana: sin PDFs de la base de
 * conocimiento, pocos tokens, temperatura 0.
 *
 * Devuelve la transcripción verbatim (sin timecodes ni etiquetas de
 * hablante). Lanza si Gemini no devuelve texto — el llamador debe hacer
 * fallback a guardar el log sin transcripción, nunca mostrar error al alumno.
 */
export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey || cleanKey === "TU_API_KEY_AQUI") {
    throw new Error("Sin API Key para transcribir.");
  }
  const ai = new GoogleGenAI({ apiKey: cleanKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: base64Audio } },
          {
            text:
              "Transcribí LITERALMENTE el audio adjunto, palabra por palabra, en español. " +
              "No agregues saludos, comentarios ni formato. No uses markdown, timecodes ni etiquetas de hablante. " +
              "Si hay fragmentos inaudibles, márcalos con [inaudible]. Devuelve SOLO la transcripción.",
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 600,
      temperature: 0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  const text = sanitizeResponseText((response?.text ?? "").trim());
  if (!text) {
    throw new Error("Transcripción vacía.");
  }
  return text;
}

/** Cuenta palabras separadas por espacios (igual criterio que la UI). */
export function countWords(text: string): number {
  const t = (text ?? "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Ampliación automática: si la respuesta salió por debajo del mínimo
 * (el modelo a veces ignora la extensión pedida), se le reenvía su propio
 * texto con los PDFs y se le pide desarrollarlo hasta 200-250 palabras,
 * en el mismo tono y formato. Se llama UNA sola vez por consulta, en
 * segundo plano dentro del flujo de "processing" (sin interacción).
 */
export async function expandAnswer(
  previousAnswer: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey || cleanKey === "TU_API_KEY_AQUI") {
    throw new Error("Sin API Key para ampliar.");
  }
  const ai = new GoogleGenAI({ apiKey: cleanKey });
  onProgress?.("Ampliando respuesta…");
  const pdfParts = await buildKnowledgeBaseParts(ai, onProgress);
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        parts: [
          ...pdfParts,
          {
            text:
              "Esta fue tu respuesta, pero quedó por debajo de las 200 palabras mínimas y eso es INACEPTABLE. " +
              "PROHIBIDO devolver menos de 200 palabras. Desarrollala hasta alcanzar entre 200 y 250 palabras, " +
              "manteniendo prosa continua, sin saludos, sin listas, sin cuadros y sin usar el término 'adaptación'. " +
              "Estrategia obligatoria: agregá al menos dos párrafos nuevos con precisiones teóricas de los PDFs " +
              "(citas de autor, categorías) y ejemplos fílmicos concretos con análisis de procedimientos formales. " +
              "Devolvé la respuesta COMPLETA ampliada, no solo lo agregado:\n\n" +
              previousAnswer,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 2400,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      temperature: 0.3,
    },
  });
  const text = sanitizeResponseText((response?.text ?? "").trim());
  if (!text) {
    throw new Error("Ampliación vacía.");
  }
  return text;
}
