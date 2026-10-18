# 📋 Documento de Progreso y Guía de Continuación - UCS Simtryx Analytics

Este documento consolida todo el trabajo realizado en el proyecto **UCS Simtryx**, su arquitectura técnica, hallazgos sobre la plataforma Simtryx, y la guía paso a paso para clonar, ejecutar y seguir desarrollando desde otra computadora (por ejemplo, en casa).

---

## 📌 1. Visión General del Proyecto

**UCS Simtryx** es una plataforma web analítica y ejecutiva construida en **Next.js 16**, **TypeScript** y **Tailwind CSS**, diseñada para auditar el uso de simuladores clínicos en la **Universidad Científica del Sur**.

### Capacidades principales:
1. **Extracción y Desencriptación de Datos de Simtryx:**  
   Conexión automatizada mediante ingeniería inversa del flujo NextAuth v5 y Server Actions de `platform.simtryx.com`, procesando en tiempo real las **460 simulaciones históricas** registradas.
2. **Dashboard Interactivo Reactivo:**  
   - Filtrado dinámico por **Mes / Periodo** (ej. *Histórico Consolidado*, *Octubre 2026*, *Mayo 2026*, etc.) que recalcula en tiempo real horas acumuladas, sesiones efectivas y aprobados.
   - Píldoras de filtrado rápido por escenario clínico.
   - Fichas modales de **Auditoría Clínica** con visualización de preguntas de juicio clínico (Debriefing) y rúbricas de procedimientos (Checklists de omisión y cumplimiento).
   - Ficha modal de **Kardex del Colaborador** por cada usuario (`gfloresy`, `mquispee`, `jcalderoncas`, etc.).
3. **Generación de Reportes Excel Ejecutivos con Gráficos:**  
   Exportación `.xlsx` multicapa con **4 gráficos integrados de alta resolución**, matrices de riesgo clínico y tablas dinámicas formateadas con la identidad visual UCS.

---

## 🚀 2. Guía para Continuar en Casa (Setup Inicial)

### Requisitos previos:
- **Node.js** v18 o v20+ instalado ([nodejs.org](https://nodejs.org/)).
- **Git** instalado.

### Pasos para iniciar en otra máquina:

1. **Clonar el repositorio de GitHub:**
   ```bash
   git clone https://github.com/VinKE3/ucs_simtryx.git
   cd ucs_simtryx
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar el archivo `.env.local`:**  
   Copia el archivo de ejemplo `.env.example`:
   ```bash
   cp .env.example .env.local
   ```
   Abre `.env.local` y coloca las credenciales reales de Simtryx:
   ```env
   SIMTRYX_BASE_URL=https://platform.simtryx.com
   SIMTRYX_EMAIL=tu_correo_de_acceso@cientifica.edu.pe
   SIMTRYX_PASSWORD=tu_contraseña_real
   ```
   *(Nota: `.env.local` está ignorado en `.gitignore` para proteger tus claves en GitHub).*

4. **Levantar el entorno de desarrollo:**
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

5. **Para compilar y verificar producción:**
   ```bash
   npm run build
   npm start
   ```

---

## 🏗️ 3. Estructura y Componentes Clave del Código

```text
ucs_simtryx/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── simulations/
│   │   │   │   ├── route.ts            # Endpoint GET que sirve las 460 simulaciones procesadas
│   │   │   │   └── export/
│   │   │   │       └── route.ts        # Endpoint GET que genera y descarga el Excel con gráficos
│   │   │   └── simtryx/test/route.ts   # Endpoint de prueba rápida de conectividad
│   │   ├── globals.css                 # Estilos globales y utilidades de Tailwind CSS
│   │   ├── layout.tsx                  # Layout con soporte claro/oscuro e Inter Font
│   │   └── page.tsx                    # Dashboard principal, KPI cards reactivas, filtros y modales
│   └── lib/
│       ├── simtryx.ts                  # Cliente NextAuth v5 + invocador Server Action de Simtryx
│       └── excel-generator.ts          # Motor ExcelJS + QuickChart (4 hojas y 4 gráficos PNG)
├── .env.example                        # Plantilla de variables de entorno (segura)
├── .gitignore                          # Protección de .env, node_modules y *.xlsx
├── tailwind.config.ts                  # Configuración de paleta de colores y temas
└── next.config.ts                      # Configuración de Next.js 16 con Turbopack
```

### Funciones destacadas:
- [`src/lib/simtryx.ts`](file:///c:/Users/Gaurmard/Desktop/ucs_simtryx/src/lib/simtryx.ts):
  - `fetchSimtryxData()`: Obtiene CSRF token, ejecuta login contra `/api/auth/callback/credentials`, y envía el payload al Server Action `408ef67208ac1da449a64910bbcf71b030537dc28a` en `/all-simulations`.
  - `getScenarioFriendlyName(id)`: Mapea identificadores crudos como `advance-anaphylacticshock-p0` a nombres limpios en español (*Shock Anafiláctico Avanzado*).
- [`src/lib/excel-generator.ts`](file:///c:/Users/Gaurmard/Desktop/ucs_simtryx/src/lib/excel-generator.ts):
  - Construye 4 hojas de cálculo temáticas:
    1. **Resumen Ejecutivo:** KPIs, tabla consolidada y 2 gráficos integrados (Barras de horas por caso y Dona de continuidad).
    2. **Detalle de Simulaciones:** Registro completo de los 460 eventos con AutoFiltro, freeze headers y formato condicional de notas.
    3. **Horas por Colaborador:** Ranking tipo Kardex con gráfico de barras de los principales participantes.
    4. **Seguridad y Errores Clínicos:** Matriz de omisiones de checklist con semáforo de riesgo y gráfico de criticidad.

---

## 🔍 4. Hallazgos Importantes en los Datos de Simtryx

Al auditar la base de datos completa (460 registros), se identificaron dos conclusiones críticas:

1. **Horas de Uso y Sesiones Efectivas:**
   - **110.73 horas** de uso acumuladas en total.
   - **401 sesiones efectivas** ($\ge 2$ minutos de duración, promedio de 14.5 minutos por simulación).
   - **59 sesiones abortadas** ($< 2$ minutos), causadas principalmente por pruebas de docentes o desconexiones tempranas.

2. **¿Por qué algunos casos tienen más opciones que otros?**
   - **Causa de Plataforma:** Casos maduros (*Shock Anafiláctico*, *Crisis Asmática*, *Trauma Interno*) tienen en Simtryx cargado un cuestionario de razonamiento post-caso (Debriefing) y una rúbrica de checklist obligatoria. Casos experimentales o abiertos (*Sepsis de Foco Abdominal*, *ACV Isquémico*) tienen el 100% de sus registros vacíos (`checklist: []`, `debriefing: []`) porque Simtryx no les configuró matriz evaluativa.
   - **Causa de Flujo de Usuario:** Incluso en casos con rúbrica, si el alumno o docente no pulsa *"Finalizar Simulación y Pasar a Evaluación"* y en su lugar cierra el navegador, Simtryx guarda el tiempo pero deja el checklist vacío con nota `0.0%`.

---

## 💡 5. Ideas y Backlog de Mejoras Futuras (Para hacer en casa)

Si deseas seguir enriqueciendo la plataforma, aquí tienes una lista de características listas para implementar:

1. **Caché en Memoria o TTL (Optimización de Carga):**  
   Actualmente cada recarga consulta directamente a Simtryx. Se puede añadir una caché de 5 a 10 minutos en `src/app/api/simulations/route.ts` usando una variable global o `unstable_cache` para que cargue en 50 milisegundos.
2. **Selector de Rango de Fechas Personalizado (Date Picker):**  
   Permitir filtrar no solo por mes completo, sino por un intervalo exacto (ej. *Del 01/08/2026 al 15/08/2026*).
3. **Exportación a PDF Individual por Simulación:**  
   Un botón dentro de la **Ficha de Auditoría Clínica** para descargar un informe en PDF de esa simulación específica, ideal para adjuntar al legajo del alumno o auditorías de SUNEDU / SINEACE.
4. **Gráficos Interactivos Web:**  
   Integrar gráficos directamente en el dashboard web (usando librerías ligeras como `recharts` o `chart.js`), replicando visualmente los gráficos que ya se generan en el Excel.
5. **Detector de Alumnos en Riesgo:**  
   Crear una alerta automática para identificar estudiantes con más de 2 sesiones consecutivas con nota menor al 70% o alta tasa de omisión en checklists críticos de vía aérea y soporte hemodinámico.

---

## 🔄 6. Comandos Git para Sincronizar Cambios

Cuando hagas cambios en casa:
```bash
# Ver qué archivos se modificaron
git status

# Añadir cambios
git add .

# Hacer commit
git commit -m "feat: mi nueva mejora"

# Subir a GitHub
git push origin main
```

Y cuando regreses a tu otra computadora:
```bash
# Descargar las últimas mejoras
git pull origin main
```
