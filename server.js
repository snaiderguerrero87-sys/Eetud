const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const fs = require('fs');
require('dotenv').config();

const { pool, testConnection } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIGURACIONES CON LÍMITE AUMENTADO =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== SESIONES GUARDADAS EN MYSQL (PERSISTENTES) =====
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    createDatabaseTable: true,   // crea automáticamente la tabla 'sessions'
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false
    }
});

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'eetud_secret_key_2026_muy_segura',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: false,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// ===== MIDDLEWARE DE DEPURACIÓN =====
app.use((req, res, next) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📡 SOLICITUD:', req.method, req.url);
    console.log('🆔 Session ID:', req.sessionID);
    console.log('👤 Usuario en sesión:', req.session?.usuario?.username || '❌ No autenticado');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    next();
});

// ===== MIDDLEWARE PARA VERIFICAR AUTENTICACIÓN =====
function verificarAutenticacion(req, res, next) {
    if (req.session && req.session.usuario) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== FUNCIONES AUXILIARES =====
function guardarEmpresaInfo(usuario) {
    // Ya no se usa con MySQL
}

function leerUnidadesGuardadas() {
    try {
        const unidadesPath = path.join(__dirname, 'data', 'unidades.json');
        if (fs.existsSync(unidadesPath)) {
            const data = fs.readFileSync(unidadesPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Error al leer unidades:', e);
    }
    return ['und', 'm', 'm2', 'm3', 'kg', 'ml', 'hr', 'dia'];
}

function leerMaterialesGuardados() {
    try {
        const materialesPath = path.join(__dirname, 'data', 'materiales.json');
        if (fs.existsSync(materialesPath)) {
            const data = fs.readFileSync(materialesPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Error al leer materiales:', e);
    }
    return [];
}

function leerCategoriasGuardadas() {
    try {
        const categoriasPath = path.join(__dirname, 'data', 'categorias.json');
        if (fs.existsSync(categoriasPath)) {
            const data = fs.readFileSync(categoriasPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Error al leer categorías:', e);
    }
    return [];
}

// ===== RUTA DE LANDING PAGE (PÚBLICA) =====
app.get('/', (req, res) => {
    if (req.session && req.session.usuario) {
        return res.redirect('/dashboard');
    }
    res.render('landing', {
        title: 'Eetud - Software de Planificación de Recursos Empresariales'
    });
});

// ===== RUTA DE DASHBOARD (PROTEGIDA) =====
app.get('/dashboard', verificarAutenticacion, (req, res) => {
    res.render('dashboard', {
        title: 'Dashboard - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username,
        usuarioData: req.session.usuario
    });
});

// ============================================================
// ===== RUTAS DE AUTENTICACIÓN (MYSQL) =====
// ============================================================

// Login - GET
app.get('/login', (req, res) => {
    if (req.session && req.session.usuario) {
        res.redirect('/dashboard');
    } else {
        res.render('login', {
            title: 'Iniciar Sesión - Eetud',
            error: null
        });
    }
});

// Login - POST (MYSQL)
app.post('/login', async (req, res) => {
    console.log('🔑 === INICIO DE LOGIN ===');
    const { username, password } = req.body;

    if (!username || !password) {
        return res.render('login', {
            title: 'Iniciar Sesión - Eetud',
            error: 'Por favor, ingresa todos los campos'
        });
    }

    try {
        const [rows] = await pool.query(
            'SELECT * FROM usuarios WHERE (username = ? OR email = ?) AND password = ? LIMIT 1',
            [username, username, password]
        );

        if (rows.length === 0) {
            console.log('❌ Credenciales incorrectas');
            return res.render('login', {
                title: 'Iniciar Sesión - Eetud',
                error: 'Usuario o contraseña incorrectos'
            });
        }

        const usuario = rows[0];
        console.log('✅ Usuario encontrado:', usuario.username);

        req.session.usuario = {
            id: usuario.id,
            username: usuario.username,
            email: usuario.email,
            telefono: usuario.telefono,
            nit: usuario.nit,
            nombreCompleto: usuario.nombreCompleto || usuario.username
        };

        req.session.save((err) => {
            if (err) {
                console.log('❌ Error al guardar sesión:', err);
                return res.render('login', {
                    title: 'Iniciar Sesión - Eetud',
                    error: 'Error al iniciar sesión'
                });
            }
            console.log('✅ Sesión guardada');
            res.redirect('/dashboard');
        });
    } catch (error) {
        console.error('❌ Error en login:', error);
        res.render('login', {
            title: 'Iniciar Sesión - Eetud',
            error: 'Error interno del servidor'
        });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.log('Error al cerrar sesión:', err);
        res.redirect('/');
    });
});

// Registro - GET
app.get('/registro', (req, res) => {
    if (req.session && req.session.usuario) {
        res.redirect('/dashboard');
    } else {
        res.render('registro', {
            title: 'Registro - Eetud',
            error: null
        });
    }
});

// Registro - POST (MYSQL)
app.post('/registro', async (req, res) => {
    console.log('📝 === INICIO DE REGISTRO ===');
    const { username, nombreCompleto, email, telefono, nit, password, confirmPassword } = req.body;

    if (!username || !email || !telefono || !nit || !password || !confirmPassword) {
        return res.render('registro', {
            title: 'Registro - Eetud',
            error: 'Por favor, completa todos los campos obligatorios'
        });
    }

    if (password !== confirmPassword) {
        return res.render('registro', {
            title: 'Registro - Eetud',
            error: 'Las contraseñas no coinciden'
        });
    }

    if (password.length < 6) {
        return res.render('registro', {
            title: 'Registro - Eetud',
            error: 'La contraseña debe tener al menos 6 caracteres'
        });
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO usuarios (username, nombreCompleto, email, telefono, nit, password)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, nombreCompleto || username, email, telefono, nit, password]
        );

        const nuevoId = result.insertId;
        console.log('✅ Usuario creado con ID:', nuevoId);

        await pool.query(
            'INSERT INTO empresa_info (usuario_id, nombre, nit, telefono, email) VALUES (?, ?, ?, ?, ?)',
            [nuevoId, nombreCompleto || username, nit, telefono, email]
        );

        req.session.usuario = {
            id: nuevoId,
            username,
            email,
            telefono,
            nit,
            nombreCompleto: nombreCompleto || username
        };

        req.session.save((err) => {
            if (err) console.log('❌ Error al guardar sesión:', err);
            res.redirect('/dashboard');
        });
    } catch (error) {
        console.error('❌ Error en registro:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.render('registro', {
                title: 'Registro - Eetud',
                error: 'Usuario, email o NIT ya registrado'
            });
        }
        res.render('registro', {
            title: 'Registro - Eetud',
            error: 'Error interno del servidor'
        });
    }
});

// ============================================================
// ===== EMPRESA INFO (PENDIENTE MIGRAR) =====
// ============================================================

app.get('/api/empresa-info', async (req, res) => {
    try {
        const empresaPath = path.join(__dirname, 'data', 'empresaInfo.json');
        if (fs.existsSync(empresaPath)) {
            const data = fs.readFileSync(empresaPath, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({});
        }
    } catch (e) {
        console.error('❌ Error al leer empresaInfo:', e);
        res.status(500).json({ error: 'Error al leer empresaInfo' });
    }
});

app.post('/api/guardar-empresa', async (req, res) => {
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        const empresaPath = path.join(dataPath, 'empresaInfo.json');
        fs.writeFileSync(empresaPath, JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'Información guardada' });
    } catch (error) {
        console.error('❌ Error al guardar empresa info:', error);
        res.status(500).json({ error: 'Error al guardar información' });
    }
});

// ===== RUTA DE PRUEBA =====
app.get('/api/ping', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        session: req.session?.usuario?.username || 'no autenticado'
    });
});

// ============================================================
// ===== APUS (PENDIENTE MIGRAR) =====
// ============================================================

app.get('/api/apus', verificarAutenticacion, (req, res) => {
    try {
        const apuPath = path.join(__dirname, 'data', 'apu.json');
        if (fs.existsSync(apuPath)) {
            const data = fs.readFileSync(apuPath, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('❌ Error al leer APUs:', error);
        res.status(500).json({ error: 'Error al leer APUs' });
    }
});

app.post('/api/guardar-apus', verificarAutenticacion, (req, res) => {
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        const apuPath = path.join(dataPath, 'apu.json');
        fs.writeFileSync(apuPath, JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'APUs guardados' });
    } catch (error) {
        console.error('❌ Error al guardar APUs:', error);
        res.status(500).json({ error: 'Error al guardar APUs' });
    }
});

// ============================================================
// ===== EXPORTAR FORMATO APU =====
// ============================================================

app.get('/api/apus/exportar-formato', verificarAutenticacion, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');

        let unidadesGuardadas = [];
        try {
            const unidadesPath = path.join(__dirname, 'data', 'unidades.json');
            if (fs.existsSync(unidadesPath)) {
                const data = fs.readFileSync(unidadesPath, 'utf8');
                unidadesGuardadas = JSON.parse(data);
            }
        } catch (e) {
            unidadesGuardadas = ['und', 'm', 'm2', 'm3', 'kg', 'ml', 'hr', 'dia'];
        }

        const workbook = new ExcelJS.Workbook();
        const listasSheet = workbook.addWorksheet('Listas');
        listasSheet.state = 'hidden';

        listasSheet.getCell('B1').value = 'UNIDADES';
        listasSheet.getCell('B1').font = { bold: true };
        unidadesGuardadas.forEach((u, index) => {
            listasSheet.getCell(`B${index + 2}`).value = u;
        });
        listasSheet.getColumn(2).width = 20;

        const worksheet = workbook.addWorksheet('APU');
        worksheet.columns = [
            { header: 'Código', key: 'codigo', width: 12 },
            { header: 'Nombre', key: 'nombre', width: 25 },
            { header: 'Categoría', key: 'categoria', width: 25 },
            { header: 'Unidad', key: 'unidad', width: 10 },
            { header: 'Nombre del Equipo/Herramienta', key: 'nombreEquipo', width: 30 },
            { header: 'Unidad Equipo (%)', key: 'unidadEquipo', width: 18 },
            { header: 'Porcentaje (%)', key: 'porcentaje', width: 15 },
            { header: 'Valor Base Equipo', key: 'valorBaseEquipo', width: 18 },
            { header: 'Nombre del Transporte', key: 'nombreTransporte', width: 30 },
            { header: 'Unidad Transporte (%)', key: 'unidadTransporte', width: 18 },
            { header: 'Porcentaje Transporte (%)', key: 'porcentajeTransporte', width: 15 },
            { header: 'Valor Base Transporte', key: 'valorBaseTransporte', width: 18 },
            { header: 'Descripción Mano de Obra', key: 'descripcionMano', width: 30 },
            { header: 'Unidad Mano de Obra', key: 'unidadMano', width: 18 },
            { header: 'Cantidad Mano de Obra', key: 'cantidadMano', width: 15 },
            { header: 'Valor Unitario Mano de Obra', key: 'valorUnitarioMano', width: 18 }
        ];

        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002735' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 25;

        const data = [
            ['A001', 'Excavación Manual', 'Movimiento de Tierra', 'm3', 'Excavadora', '%', '15', '50000', 'Flete', '%', '10', '30000', 'Oficial', 'und', '2', '80000'],
            ['A001', 'Excavación Manual', 'Movimiento de Tierra', 'm3', '', '%', '', '', '', '%', '', '', 'Ayudante', 'und', '4', '50000'],
            ['B001', 'Cimentación', 'Estructura', 'm3', 'Mezcladora', '%', '10', '60000', '', '%', '', '', 'Ingeniero', 'und', '1', '120000'],
            ['B001', 'Cimentación', 'Estructura', 'm3', '', '%', '', '', '', '%', '', '', 'Oficial', 'und', '3', '80000']
        ];

        data.forEach(row => worksheet.addRow(row));

        for (let rowNum = 2; rowNum <= data.length + 1; rowNum++) {
            worksheet.getCell(`D${rowNum}`).dataValidation = {
                type: 'list',
                formulae: ['=Listas!B:B'],
                showErrorMessage: true,
                errorTitle: 'Valor inválido',
                error: 'Selecciona una unidad de la lista'
            };
        }

        const instruccionesSheet = workbook.addWorksheet('Instrucciones');
        instruccionesSheet.getColumn(1).width = 80;
        const instrucciones = [
            '📋 INSTRUCCIONES PARA IMPORTAR APU',
            '',
            '📋 UNIDADES DISPONIBLES: ' + unidadesGuardadas.length + ' unidades',
            '',
            '1. Un mismo APU puede tener múltiples filas (mismo Código)',
            '2. Columnas obligatorias: Código, Nombre, Categoría, Unidad',
            '3. EQUIPOS: Nombre, Unidad Equipo (%), Porcentaje (%), Valor Base',
            '4. TRANSPORTE: Nombre, Unidad Transporte (%), Porcentaje (%), Valor Base',
            '5. MANO DE OBRA: Descripción, Unidad, Cantidad, Valor Unitario',
            '6. Las categorías nuevas se crearán automáticamente'
        ];
        instrucciones.forEach(line => instruccionesSheet.addRow([line]));

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=formato_apu.xlsx');
        res.send(buffer);

    } catch (error) {
        console.error('❌ Error al exportar formato APU:', error);
        res.status(500).json({ error: 'Error al exportar formato: ' + error.message });
    }
});

// ============================================================
// ===== IMPORTAR APUS =====
// ============================================================

app.post('/api/apus/importar', verificarAutenticacion, (req, res) => {
    try {
        const XLSX = require('xlsx');
        const { file } = req.body;

        if (!file) return res.status(400).json({ error: 'No se recibió el archivo' });

        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });

        let sheetName = 'APU';
        let worksheet = workbook.Sheets[sheetName];

        if (!worksheet) {
            const sheetNames = workbook.SheetNames;
            for (let i = 0; i < sheetNames.length; i++) {
                const testSheet = workbook.Sheets[sheetNames[i]];
                const testData = XLSX.utils.sheet_to_json(testSheet, { defval: '' });
                if (testData.length > 0) {
                    worksheet = testSheet;
                    sheetName = sheetNames[i];
                    break;
                }
            }
        }

        if (!worksheet) return res.status(400).json({ error: 'No se encontró la hoja "APU"' });

        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        const data = rawData.map(row => {
            const newRow = {};
            Object.keys(row).forEach(key => { newRow[key.trim()] = row[key]; });
            return newRow;
        });

        if (data.length === 0) return res.status(400).json({ error: 'El archivo está vacío' });

        const headers = Object.keys(data[0]);
        const requiredHeaders = ['Código', 'Nombre', 'Categoría', 'Unidad'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

        if (missingHeaders.length > 0) {
            return res.status(400).json({
                error: `Faltan columnas: ${missingHeaders.join(', ')}`,
                required: requiredHeaders
            });
        }

        let errores = [];
        let codigos = {};
        let categoriasNuevas = [];
        let categoriasExistentes = leerCategoriasGuardadas();

        function obtenerNumero(valor) {
            if (!valor) return 0;
            if (typeof valor === 'number') return valor;
            let limpio = String(valor).replace(/[€£¥$.,\s]/g, '');
            return parseFloat(limpio) || 0;
        }

        function obtenerString(valor) {
            return valor === undefined || valor === null ? '' : String(valor).trim();
        }

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const filaNum = i + 2;

            const codigo = obtenerString(row['Código']);
            const nombre = obtenerString(row['Nombre']);
            const categoria = obtenerString(row['Categoría']);
            const unidad = obtenerString(row['Unidad']).toUpperCase();

            if (!codigo || !nombre || !categoria || !unidad) {
                errores.push(`Fila ${filaNum}: Campos obligatorios vacíos`);
                continue;
            }

            if (categoria && !categoriasExistentes.some(c => c.toLowerCase() === categoria.toLowerCase())) {
                if (!categoriasNuevas.includes(categoria)) categoriasNuevas.push(categoria);
            }

            if (!codigos[codigo]) codigos[codigo] = [];
            codigos[codigo].push(filaNum);
        }

        if (errores.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Errores en el archivo',
                detalles: errores
            });
        }

        res.json({
            success: true,
            message: '✅ Validación exitosa',
            filasProcesadas: data.length,
            codigosEncontrados: Object.keys(codigos).length,
            categoriasNuevas: categoriasNuevas
        });

    } catch (error) {
        res.status(500).json({ error: 'Error al importar: ' + error.message });
    }
});

// ============================================================
// ===== PDF APU =====
// ============================================================

app.get('/api/apu-pdf/:id', verificarAutenticacion, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const apuId = parseInt(req.params.id);
        const apuPath = path.join(__dirname, 'data', 'apu.json');
        const empresaPath = path.join(__dirname, 'data', 'empresaInfo.json');

        let apuData = null;
        let empresaData = {};

        if (fs.existsSync(apuPath)) {
            const data = fs.readFileSync(apuPath, 'utf8');
            const apus = JSON.parse(data);
            apuData = apus.find(a => a.id === apuId);
        }

        if (!apuData) return res.status(404).json({ error: 'APU no encontrado' });

        if (fs.existsSync(empresaPath)) {
            const data = fs.readFileSync(empresaPath, 'utf8');
            empresaData = JSON.parse(data);
        }

        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            info: {
                Title: `APU - ${apuData.codigo}`,
                Author: empresaData.nombre || 'Eetud',
                Subject: 'Análisis de Precios Unitarios'
            }
        });

        const filename = `APU_${apuData.codigo}_${new Date().toISOString().slice(0,10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        doc.pipe(res);

        function formatearPrecio(valor) {
            return '$' + Number(valor).toLocaleString('es-CO');
        }

        function formatearFecha() {
            const ahora = new Date();
            return ahora.toLocaleDateString('es-CO', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }

        const pageWidth = doc.page.width - 80;
        let currentY = 40;

        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(40, currentY, pageWidth, 90).stroke();

        let logoX = 55;
        let logoY = currentY + 10;
        let logoCargado = false;

        if (empresaData.logo && empresaData.logo.startsWith('data:image')) {
            try {
                const base64Data = empresaData.logo.replace(/^data:image\/\w+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const tempLogoPath = path.join(__dirname, 'data', 'temp_logo.png');
                fs.writeFileSync(tempLogoPath, imageBuffer);
                doc.image(tempLogoPath, logoX, logoY, { width: 65, height: 65 });
                logoCargado = true;
                logoX = 135;
                fs.unlinkSync(tempLogoPath);
            } catch (e) { console.error('Error al cargar logo:', e.message); }
        }

        if (!logoCargado) {
            try {
                const defaultLogoPath = path.join(__dirname, 'public', 'assets', 'logo.jpg');
                if (fs.existsSync(defaultLogoPath)) {
                    doc.image(defaultLogoPath, logoX, logoY, { width: 65, height: 65 });
                    logoCargado = true;
                    logoX = 135;
                }
            } catch (e) {}
        }

        if (!logoCargado) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('LOGO', logoX + 10, logoY + 20, { width: 65, align: 'center' });
            logoX = 135;
        }

        const empresaNombre = empresaData.nombre || 'MI EMPRESA';
        let textX = logoX + 10;
        let textY = currentY + 12;

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#002735');
        doc.text(empresaNombre.toUpperCase(), textX, textY);
        textY += 20;

        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        if (empresaData.nit) { doc.text(`NIT: ${empresaData.nit}`, textX, textY); textY += 14; }
        if (empresaData.direccion) { doc.text(`Dirección: ${empresaData.direccion}`, textX, textY); textY += 14; }
        if (empresaData.telefono) { doc.text(`Teléfono: ${empresaData.telefono}`, textX, textY); textY += 14; }
        if (empresaData.email) { doc.text(`Email: ${empresaData.email}`, textX, textY); textY += 14; }

        const fechaTexto = `Fecha de emisión: ${formatearFecha()}`;
        const fechaWidth = doc.widthOfString(fechaTexto);
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        doc.text(fechaTexto, doc.page.width - 50 - fechaWidth, currentY + 12);

        currentY += 95;
        doc.strokeColor('#002735').lineWidth(1.5);
        doc.moveTo(40, currentY).lineTo(doc.page.width - 40, currentY).stroke();
        currentY += 10;

        doc.fontSize(22).font('Helvetica-Bold').fillColor('#002735');
        const titulo = `ANÁLISIS DE PRECIOS UNITARIOS`;
        const tituloWidth = doc.widthOfString(titulo);
        doc.text(titulo, (doc.page.width - tituloWidth) / 2, currentY);
        currentY += 30;

        const tituloY = currentY;
        doc.fillColor('#002735');
        doc.rect(50, tituloY, pageWidth, 25).fill();
        doc.fillColor('white');
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('INFORMACIÓN APU', 55, tituloY + 7);
        currentY = tituloY + 25 + 4;

        doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
        const campos = [
            { label: 'Código', value: apuData.codigo || '-' },
            { label: 'Nombre', value: apuData.nombre || '-' },
            { label: 'Categoría', value: apuData.categoria || '-' },
            { label: 'Unidad', value: apuData.unidad || '-' },
            { label: 'Valor Unitario', value: formatearPrecio(apuData.valor || 0) }
        ];

        for (let i = 0; i < campos.length; i++) {
            const campo = campos[i];
            if (currentY > doc.page.height - 100) {
                doc.addPage();
                currentY = 50;
            }
            if (i % 2 === 0) {
                doc.fillColor('#f8fafc');
                doc.rect(50, currentY - 2, pageWidth, 18).fill();
                doc.fillColor('#0f172a');
            }
            doc.text(campo.label + ':', 55, currentY);
            doc.text(campo.value, 200, currentY);
            currentY += 16;
        }
        doc.strokeColor('#e2e8f0').lineWidth(1);
        doc.moveTo(50, currentY - 4).lineTo(doc.page.width - 40, currentY - 4).stroke();
        currentY += 10;

        // Equipos
        const equipos = apuData.items?.equipos || [];
        if (equipos.length > 0) {
            const colX = [50, 180, 280, 380, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('EQUIPOS Y HERRAMIENTAS', 50, y);
            y += 18;
            doc.fillColor('#002735');
            doc.rect(50, y, pageWidth, 20).fill();
            doc.fillColor('white');
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('NOMBRE', colX[0] + 5, y + 5);
            doc.text('UNIDAD', colX[1] + 5, y + 5);
            doc.text('PORCENTAJE', colX[2] + 5, y + 5);
            doc.text('VALOR BASE', colX[3] + 5, y + 5);
            doc.text('SUBTOTAL', colX[4] + 5, y + 5);
            y += 20;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
            let subtotalEquipos = 0;
            for (let i = 0; i < equipos.length; i++) {
                const e = equipos[i];
                subtotalEquipos += e.subtotal || 0;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) {
                    doc.fillColor('#f8fafc');
                    doc.rect(50, y - 2, pageWidth, 18).fill();
                    doc.fillColor('#0f172a');
                }
                doc.text((e.nombre || '').substring(0, 20), colX[0] + 5, y);
                doc.text(e.unidad || '%', colX[1] + 5, y);
                doc.text((e.porcentaje || 0) + '%', colX[2] + 5, y);
                doc.text(formatearPrecio(e.valorBase || 0), colX[3] + 5, y);
                doc.text(formatearPrecio(e.subtotal || 0), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal Equipos y Herramientas: ${formatearPrecio(subtotalEquipos)}`;
            const subW = doc.widthOfString(subtotalText);
            doc.text(subtotalText, doc.page.width - 50 - subW, y);
            currentY = y + 20;
        }

        // Transporte
        const transportes = apuData.items?.transporte || [];
        if (transportes.length > 0) {
            const colX = [50, 180, 280, 380, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('TRANSPORTE DE MATERIALES', 50, y);
            y += 18;
            doc.fillColor('#002735');
            doc.rect(50, y, pageWidth, 20).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('NOMBRE', colX[0] + 5, y + 5);
            doc.text('UNIDAD', colX[1] + 5, y + 5);
            doc.text('PORCENTAJE', colX[2] + 5, y + 5);
            doc.text('VALOR BASE', colX[3] + 5, y + 5);
            doc.text('SUBTOTAL', colX[4] + 5, y + 5);
            y += 20;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
            let subtotalTransporte = 0;
            for (let i = 0; i < transportes.length; i++) {
                const t = transportes[i];
                subtotalTransporte += t.subtotal || 0;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) {
                    doc.fillColor('#f8fafc');
                    doc.rect(50, y - 2, pageWidth, 18).fill();
                    doc.fillColor('#0f172a');
                }
                doc.text((t.nombre || '').substring(0, 20), colX[0] + 5, y);
                doc.text(t.unidad || '%', colX[1] + 5, y);
                doc.text((t.porcentaje || 0) + '%', colX[2] + 5, y);
                doc.text(formatearPrecio(t.valorBase || 0), colX[3] + 5, y);
                doc.text(formatearPrecio(t.subtotal || 0), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal Transporte: ${formatearPrecio(subtotalTransporte)}`;
            const subW = doc.widthOfString(subtotalText);
            doc.text(subtotalText, doc.page.width - 50 - subW, y);
            currentY = y + 20;
        }

        // Mano de Obra
        const cargos = apuData.items?.cargos || [];
        if (cargos.length > 0) {
            const colX = [50, 200, 320, 420, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('MANO DE OBRA', 50, y);
            y += 18;
            doc.fillColor('#002735');
            doc.rect(50, y, pageWidth, 20).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('DESCRIPCIÓN', colX[0] + 5, y + 5);
            doc.text('UNIDAD', colX[1] + 5, y + 5);
            doc.text('CANTIDAD', colX[2] + 5, y + 5);
            doc.text('VALOR UNIT.', colX[3] + 5, y + 5);
            doc.text('SUBTOTAL', colX[4] + 5, y + 5);
            y += 20;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
            let subtotalCargos = 0;
            for (let i = 0; i < cargos.length; i++) {
                const c = cargos[i];
                const subtotal = c.subtotal || (c.valorUnitario * c.cantidad);
                subtotalCargos += subtotal;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) {
                    doc.fillColor('#f8fafc');
                    doc.rect(50, y - 2, pageWidth, 18).fill();
                    doc.fillColor('#0f172a');
                }
                doc.text((c.descripcion || '').substring(0, 20), colX[0] + 5, y);
                doc.text(c.unidad || 'und', colX[1] + 5, y);
                doc.text(String(c.cantidad || 0), colX[2] + 5, y);
                doc.text(formatearPrecio(c.valorUnitario || 0), colX[3] + 5, y);
                doc.text(formatearPrecio(subtotal), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal Mano de Obra: ${formatearPrecio(subtotalCargos)}`;
            const subW = doc.widthOfString(subtotalText);
            doc.text(subtotalText, doc.page.width - 50 - subW, y);
            currentY = y + 20;
        }

        currentY += 10;
        const totalY = currentY;
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(50, totalY, pageWidth, 35).stroke();
        doc.fillColor('#002735');
        doc.rect(50, totalY, pageWidth, 35).fill();
        doc.fillColor('white').fontSize(16).font('Helvetica-Bold');
        doc.text('VALOR UNITARIO TOTAL:', 65, totalY + 10);
        const totalValue = formatearPrecio(apuData.valor || 0);
        const totalWidth = doc.widthOfString(totalValue);
        doc.text(totalValue, doc.page.width - 50 - totalWidth - 10, totalY + 10);

        doc.end();

    } catch (error) {
        console.error('❌ ERROR al generar PDF APU:', error);
        res.status(500).json({ error: 'Error al generar el PDF: ' + error.message });
    }
});

// ============================================================
// ===== PDF COTIZACIÓN =====
// ============================================================

app.post('/api/cotizacion-pdf', verificarAutenticacion, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const { cotizacion, empresa } = req.body;

        if (!cotizacion) return res.status(400).json({ error: 'Datos incompletos' });

        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            info: {
                Title: `Cotización ${cotizacion.numero}`,
                Author: empresa.nombre || 'Eetud',
                Subject: 'Cotización de servicios'
            }
        });

        const filename = `Cotizacion_${cotizacion.numero}_${new Date().toISOString().slice(0,10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        doc.pipe(res);

        function formatearPrecio(valor) {
            return '$' + Number(valor).toLocaleString('es-CO');
        }

        function formatearFecha() {
            const ahora = new Date();
            return ahora.toLocaleDateString('es-CO', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }

        const MARGEN_IZQ = 40;
        const MARGEN_DER = doc.page.width - 40;
        const ANCHO_UTIL = MARGEN_DER - MARGEN_IZQ;
        const pageWidth = ANCHO_UTIL;
        let currentY = 40;
        let pageCount = 1;

        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, currentY, pageWidth, 90).stroke();

        let logoX = MARGEN_IZQ + 15;
        let logoY = currentY + 10;
        let logoCargado = false;

        if (empresa.logo && empresa.logo.startsWith('data:image')) {
            try {
                const base64Data = empresa.logo.replace(/^data:image\/\w+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const tempLogoPath = path.join(__dirname, 'data', 'temp_logo_cotizacion.png');
                fs.writeFileSync(tempLogoPath, imageBuffer);
                doc.image(tempLogoPath, logoX, logoY, { width: 65, height: 65 });
                logoCargado = true;
                logoX = MARGEN_IZQ + 95;
                fs.unlinkSync(tempLogoPath);
            } catch (e) { console.error('Error logo:', e.message); }
        }

        if (!logoCargado) {
            try {
                const defaultLogoPath = path.join(__dirname, 'public', 'assets', 'logo.jpg');
                if (fs.existsSync(defaultLogoPath)) {
                    doc.image(defaultLogoPath, logoX, logoY, { width: 65, height: 65 });
                    logoCargado = true;
                    logoX = MARGEN_IZQ + 95;
                }
            } catch (e) {}
        }

        if (!logoCargado) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('LOGO', logoX + 10, logoY + 20, { width: 65, align: 'center' });
            logoX = MARGEN_IZQ + 95;
        }

        let textX = logoX + 10;
        let textY = currentY + 12;

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#002735');
        doc.text((empresa.nombre || 'MI EMPRESA').toUpperCase(), textX, textY);
        textY += 20;

        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        if (empresa.nit) { doc.text(`NIT: ${empresa.nit}`, textX, textY); textY += 14; }
        if (empresa.direccion) { doc.text(`Dirección: ${empresa.direccion}`, textX, textY); textY += 14; }
        if (empresa.telefono) { doc.text(`Teléfono: ${empresa.telefono}`, textX, textY); textY += 14; }
        if (empresa.email) { doc.text(`Email: ${empresa.email}`, textX, textY); textY += 14; }
        if (empresa.web) { doc.text(`Web: ${empresa.web}`, textX, textY); textY += 14; }

        const fechaTexto = `Fecha de emisión: ${formatearFecha()}`;
        const fechaWidth = doc.widthOfString(fechaTexto);
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        doc.text(fechaTexto, MARGEN_DER - fechaWidth, currentY + 12);

        currentY += 95;
        doc.strokeColor('#002735').lineWidth(1.5);
        doc.moveTo(MARGEN_IZQ, currentY).lineTo(MARGEN_DER, currentY).stroke();
        currentY += 20;

        doc.fontSize(22).font('Helvetica-Bold').fillColor('#002735');
        const titulo = `COTIZACIÓN`;
        const tituloWidth = doc.widthOfString(titulo);
        doc.text(titulo, (doc.page.width - tituloWidth) / 2, currentY);
        currentY += 40;

        const infoY = currentY;
        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, infoY, pageWidth, 25).fill();
        doc.fillColor('white').fontSize(12).font('Helvetica-Bold');
        doc.text('INFORMACIÓN DE LA COTIZACIÓN', MARGEN_IZQ + 5, infoY + 7);
        currentY = infoY + 25 + 4;

        doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
        const campos = [
            { label: 'N° Cotización', value: cotizacion.numero || '-' },
            { label: 'Cliente', value: cotizacion.cliente || '-' },
            { label: 'Tipo', value: cotizacion.tipo || '-' },
            { label: 'Proyecto', value: cotizacion.proyecto || '-' },
            { label: 'Objetivo', value: cotizacion.objetivo || '-' },
            { label: 'Dirección', value: cotizacion.direccion || '-' }
        ];

        for (let i = 0; i < campos.length; i++) {
            const campo = campos[i];
            if (currentY > doc.page.height - 80) { doc.addPage(); currentY = 50; pageCount++; }
            if (i % 2 === 0) {
                doc.fillColor('#e8f0fe');
                doc.rect(MARGEN_IZQ, currentY - 2, pageWidth, 18).fill();
                doc.fillColor('#0f172a');
            }
            doc.text(campo.label + ':', MARGEN_IZQ + 5, currentY);
            doc.text(campo.value, MARGEN_IZQ + 150, currentY);
            currentY += 18;
        }
        doc.strokeColor('#002735').lineWidth(1);
        doc.moveTo(MARGEN_IZQ, currentY - 4).lineTo(MARGEN_DER, currentY - 4).stroke();
        currentY += 20;

        // ITEMS
        if (cotizacion.items && cotizacion.items.length > 0) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('ITEMS DE LA COTIZACIÓN', MARGEN_IZQ, currentY);
            currentY += 22;

            const colX = [MARGEN_IZQ, MARGEN_IZQ + 40, MARGEN_IZQ + 265, MARGEN_IZQ + 320, MARGEN_IZQ + 405];
            const colWidths = [40, 225, 55, 85, 110.28];
            const headerHeight = 24;

            doc.fillColor('#002735');
            doc.rect(MARGEN_IZQ, currentY, pageWidth, headerHeight).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('N°', colX[0] + 3, currentY + 7, { align: 'center', width: colWidths[0] - 6 });
            doc.text('DESCRIPCIÓN', colX[1] + 5, currentY + 7, { align: 'center', width: colWidths[1] - 10 });
            doc.text('CANTIDAD', colX[2] + 3, currentY + 7, { align: 'center', width: colWidths[2] - 6 });
            doc.text('VALOR UNIT.', colX[3] + 3, currentY + 7, { align: 'center', width: colWidths[3] - 6 });
            doc.text('SUBTOTAL', colX[4] + 3, currentY + 7, { align: 'center', width: colWidths[4] - 6 });
            currentY += headerHeight + 14;

            let subtotalGeneral = 0;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');

            let contadorTitulo = 0;
            let contadorAPUPorTitulo = {};

            for (let idx = 0; idx < cotizacion.items.length; idx++) {
                const item = cotizacion.items[idx];
                if (item.tipo === 'titulo') {
                    contadorTitulo++;
                    item.numeroMostrar = contadorTitulo + '.';
                    item._idTitulo = contadorTitulo;
                    contadorAPUPorTitulo[contadorTitulo] = 0;
                }
            }

            let tituloActual = null;
            for (let idx = 0; idx < cotizacion.items.length; idx++) {
                const item = cotizacion.items[idx];
                if (item.tipo === 'titulo') {
                    tituloActual = item;
                } else if (item.tipo === 'apu') {
                    if (tituloActual) {
                        contadorAPUPorTitulo[tituloActual._idTitulo]++;
                        item.numeroMostrar = tituloActual._idTitulo + '.' + contadorAPUPorTitulo[tituloActual._idTitulo];
                    } else {
                        item.numeroMostrar = 'APU-' + (idx + 1);
                    }
                }
            }

            let apuActual = null;
            let contadorSubitemPorAPU = {};
            for (let idx = 0; idx < cotizacion.items.length; idx++) {
                const item = cotizacion.items[idx];
                if (item.tipo === 'apu') {
                    apuActual = item;
                    contadorSubitemPorAPU[item.numeroMostrar] = 0;
                } else if (item.tipo === 'subitem') {
                    if (apuActual && apuActual.numeroMostrar) {
                        contadorSubitemPorAPU[apuActual.numeroMostrar]++;
                        item.numeroMostrar = apuActual.numeroMostrar + '.' + contadorSubitemPorAPU[apuActual.numeroMostrar];
                    } else {
                        item.numeroMostrar = '';
                    }
                }
            }

            for (let i = 0; i < cotizacion.items.length; i++) {
                const item = cotizacion.items[i];
                doc.fillColor('#0f172a').fontSize(9).font('Helvetica');

                if (item.tipo === 'titulo') {
                    var tituloTexto = (item.numeroMostrar || '') + ' ' + (item.descripcion || 'Título');
                    var tituloAncho = pageWidth - 10;
                    var tituloAltura = doc.heightOfString(tituloTexto, { width: tituloAncho });
                    var alturaFila = Math.max(18, tituloAltura + 6);

                    if (currentY + alturaFila > doc.page.height - 60) {
                        doc.addPage();
                        currentY = 50;
                        pageCount++;
                    }

                    doc.fillColor('#002735').fontSize(11).font('Helvetica-Bold');
                    doc.text(tituloTexto, MARGEN_IZQ + 5, currentY, { width: tituloAncho });
                    currentY += alturaFila;
                    doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
                } else if (item.tipo === 'apu') {
                    const cantidad = item.cantidad || 0;
                    const valorUnitario = item.valorUnitario || 0;
                    const subtotal = cantidad * valorUnitario;
                    subtotalGeneral += subtotal;

                    var numero = item.numeroMostrar || '';
                    var nombre = item.nombre || 'APU';

                    var descAncho = colWidths[1] - 10;
                    var descAltura = doc.heightOfString(nombre, { width: descAncho });
                    var alturaFila = Math.max(18, descAltura + 6);

                    if (currentY + alturaFila > doc.page.height - 60) {
                        doc.addPage();
                        currentY = 50;
                        pageCount++;
                    }

                    if (i % 2 === 0) {
                        doc.fillColor('#f0f4f8');
                        doc.rect(MARGEN_IZQ, currentY - 2, pageWidth, alturaFila).fill();
                        doc.fillColor('#0f172a');
                    }

                    doc.fontSize(9).font('Helvetica');
                    doc.text(numero, colX[0] + 3, currentY, { width: colWidths[0] - 6, align: 'center' });
                    doc.text(nombre, colX[1] + 5, currentY, { width: descAncho });
                    doc.text(cantidad.toString(), colX[2] + 3, currentY, { width: colWidths[2] - 6, align: 'center' });
                    doc.text(formatearPrecio(valorUnitario), colX[3] + 3, currentY, { width: colWidths[3] - 6, align: 'right' });
                    doc.text(formatearPrecio(subtotal), colX[4] + 3, currentY, { width: colWidths[4] - 6, align: 'right' });

                    currentY += alturaFila;
                } else if (item.tipo === 'subitem') {
                    doc.fillColor('#64748b').fontSize(9).font('Helvetica');
                    var subNumero = item.numeroMostrar || '';
                    var subDesc = item.descripcion || 'Subitem';
                    var subTexto = '   ' + subNumero + ' ' + subDesc;
                    var subAncho = pageWidth - 10;
                    var subAltura = doc.heightOfString(subTexto, { width: subAncho });
                    var alturaFila = Math.max(14, subAltura + 2);

                    if (currentY + alturaFila > doc.page.height - 60) {
                        doc.addPage();
                        currentY = 50;
                        pageCount++;
                    }

                    doc.text(subTexto, MARGEN_IZQ + 5, currentY, { width: subAncho });
                    currentY += alturaFila;
                    doc.fillColor('#0f172a');
                }
            }

            currentY += 6;
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, currentY - 4).lineTo(MARGEN_DER, currentY - 4).stroke();

            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal: ${formatearPrecio(subtotalGeneral)}`;
            const subtotalWidth = doc.widthOfString(subtotalText);
            doc.text(subtotalText, MARGEN_DER - subtotalWidth, currentY);
            currentY += 28;
        }

        // AJUSTES
        const ajustes = cotizacion.ajustes || {};
        const adminValor = ajustes.adminValor || 0;
        const imprevistosValor = ajustes.imprevistosValor || 0;
        const utilidadValor = ajustes.utilidadValor || 0;
        const ivaValor = ajustes.ivaValor || 0;
        const totalFinal = ajustes.totalFinal || cotizacion.valorTotalFinal || 0;

        if (adminValor > 0 || imprevistosValor > 0 || utilidadValor > 0 || ivaValor > 0) {
            if (currentY + 100 > doc.page.height - 60) { doc.addPage(); currentY = 50; pageCount++; }

            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('AJUSTES', MARGEN_IZQ, currentY);
            currentY += 20;

            const aColX = [MARGEN_IZQ, MARGEN_IZQ + 150, MARGEN_IZQ + 300];
            doc.fillColor('#002735');
            doc.rect(MARGEN_IZQ, currentY, pageWidth, 20).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('CONCEPTO', aColX[0] + 5, currentY + 5);
            doc.text('PORCENTAJE', aColX[1] + 5, currentY + 5, { align: 'center', width: 150 });
            doc.text('VALOR', aColX[2] + 5, currentY + 5, { align: 'right', width: pageWidth - 305 });
            currentY += 20;

            const ajustesList = [
                { label: 'Administración', porcentaje: ajustes.adminPorc || 0, valor: adminValor, activo: ajustes.adminActivo !== false },
                { label: 'Imprevistos', porcentaje: ajustes.imprevistosPorc || 0, valor: imprevistosValor, activo: ajustes.imprevistosActivo !== false },
                { label: 'Utilidad', porcentaje: ajustes.utilidadPorc || 0, valor: utilidadValor, activo: ajustes.utilidadActivo !== false },
                { label: 'IVA', porcentaje: ajustes.ivaPorc || 0, valor: ivaValor, activo: ajustes.ivaActivo !== false }
            ];

            let rowIndex = 0;
            for (let i = 0; i < ajustesList.length; i++) {
                const a = ajustesList[i];
                if (a.valor > 0 && a.activo) {
                    if (currentY + 18 > doc.page.height - 60) { doc.addPage(); currentY = 50; pageCount++; }
                    if (rowIndex % 2 === 0) {
                        doc.fillColor('#f0f4f8');
                        doc.rect(MARGEN_IZQ, currentY - 2, pageWidth, 18).fill();
                        doc.fillColor('#0f172a');
                    }
                    doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
                    doc.text(a.label + ':', aColX[0] + 5, currentY);
                    doc.text(a.porcentaje + '%', aColX[1] + 5, currentY, { align: 'center', width: 150 });
                    doc.text(formatearPrecio(a.valor), aColX[2] + 5, currentY, { align: 'right', width: pageWidth - 305 });
                    currentY += 18;
                    rowIndex++;
                }
            }
            currentY += 4;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, currentY - 4).lineTo(MARGEN_DER, currentY - 4).stroke();
            currentY += 18;
        }

        // TOTAL FINAL
        if (currentY + 50 > doc.page.height - 60) { doc.addPage(); currentY = 50; pageCount++; }

        const totalY = currentY;
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).stroke();
        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).fill();
        doc.fillColor('white').fontSize(16).font('Helvetica-Bold');
        doc.text('TOTAL COTIZACIÓN:', MARGEN_IZQ + 15, totalY + 12);
        const totalValue = formatearPrecio(totalFinal);
        const totalWidth = doc.widthOfString(totalValue);
        doc.text(totalValue, MARGEN_DER - totalWidth - 10, totalY + 12);
        currentY = totalY + 45;

        // PIE DE PÁGINA
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(range.start + i);
            const pageHeight = doc.page.height;
            const pageWidthDoc = doc.page.width;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, pageHeight - 45).lineTo(MARGEN_DER, pageHeight - 45).stroke();
            doc.fontSize(9).font('Helvetica').fillColor('#94a3b8');
            doc.text(`Página ${i + 1} de ${totalPages}`, MARGEN_IZQ, pageHeight - 35);
            const copyrightText = `Creado con Eetud™ - ${new Date().getFullYear()}`;
            const cw = doc.widthOfString(copyrightText);
            doc.text(copyrightText, (pageWidthDoc - cw) / 2, pageHeight - 35);
            const rightsText = 'Todos los derechos reservados.';
            const rw = doc.widthOfString(rightsText);
            doc.text(rightsText, MARGEN_DER - rw, pageHeight - 35);
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, pageHeight - 30).lineTo(MARGEN_DER, pageHeight - 30).stroke();
        }

        doc.end();

    } catch (error) {
        console.error('❌ ERROR al generar PDF cotización:', error);
        res.status(500).json({ error: 'Error al generar el PDF: ' + error.message });
    }
});

// ============================================================
// ===== MATERIALES =====
// ============================================================

app.get('/api/materiales/exportar-formato', verificarAutenticacion, (req, res) => {
    try {
        const XLSX = require('xlsx');
        const wb = XLSX.utils.book_new();
        const data = [
            ['ID', 'Nombre', 'Proveedor', 'Unidad', 'Precio Unitario'],
            ['1', 'Cemento Gris', 'Cementos Argos', 'Und', '25000'],
            ['2', 'Arena Fina', 'Cantera La Nueva', 'm3', '12000'],
            ['3', 'Bloque #4', 'Bloquera El Sol', 'Und', '3000']
        ];
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Materiales');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=formato_materiales.xlsx');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Error al exportar formato' });
    }
});

app.post('/api/materiales/importar', verificarAutenticacion, (req, res) => {
    try {
        const XLSX = require('xlsx');
        const { file } = req.body;
        if (!file) return res.status(400).json({ error: 'No se recibió el archivo' });

        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet);

        if (data.length === 0) return res.status(400).json({ error: 'El archivo está vacío' });

        const headers = Object.keys(data[0]);
        const requiredHeaders = ['Nombre', 'Proveedor', 'Unidad', 'Precio Unitario'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        if (missingHeaders.length > 0) {
            return res.status(400).json({ error: `Faltan columnas: ${missingHeaders.join(', ')}` });
        }

        const materiales = [];
        let errores = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const nombre = String(row['Nombre'] || '').trim();
            const proveedor = String(row['Proveedor'] || '').trim();
            const unidad = String(row['Unidad'] || '').trim();
            const precio = parseFloat(String(row['Precio Unitario'] || '0').replace(/[$,.]/g, '').trim());

            if (!nombre || !proveedor || !unidad || isNaN(precio) || precio <= 0) {
                errores.push(`Fila ${i + 2}: Datos inválidos`);
                continue;
            }

            let id = parseInt(row['ID'] || '0');
            if (isNaN(id) || id <= 0) id = null;

            materiales.push({ id, nombre, proveedor, unidad, precio });
        }

        if (errores.length > 0) {
            return res.status(400).json({ error: 'Errores en el archivo', detalles: errores, materiales });
        }

        res.json({ success: true, materiales, message: `Se importaron ${materiales.length} materiales` });
    } catch (error) {
        res.status(500).json({ error: 'Error al importar: ' + error.message });
    }
});

app.post('/api/materiales/guardar', verificarAutenticacion, (req, res) => {
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
        fs.writeFileSync(path.join(dataPath, 'materiales.json'), JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar materiales' });
    }
});

// ===== BORRAR USUARIOS (SOLO PRUEBAS) =====
app.post('/api/borrar-usuarios', async (req, res) => {
    try {
        await pool.query('DELETE FROM empresa_info');
        await pool.query('DELETE FROM usuarios');
        res.json({ success: true, message: 'Datos eliminados' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ===== RUTAS PROTEGIDAS =====

app.get('/herramientas', verificarAutenticacion, (req, res) => {
    res.render('herramientas', {
        title: 'Listado de Herramientas - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username
    });
});

app.get('/asistencia', verificarAutenticacion, (req, res) => {
    res.render('asistencia', {
        title: 'Asistencia - Empleados - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username
    });
});

app.get('/materiales', verificarAutenticacion, (req, res) => {
    res.render('materiales', {
        title: 'Listado de Materiales - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username
    });
});

app.get('/apu', verificarAutenticacion, (req, res) => {
    res.render('apu', {
        title: 'Listado de APU - Análisis de Precios Unitarios - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username
    });
});

app.get('/cotizaciones', verificarAutenticacion, (req, res) => {
    res.render('cotizaciones', {
        title: 'Listado de Cotizaciones - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username
    });
});

app.get('/proyectos', verificarAutenticacion, (req, res) => {
    res.render('proyectos', {
        title: 'Listado de Proyectos - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username
    });
});

app.get('/cuenta', verificarAutenticacion, (req, res) => {
    res.render('cuenta', {
        title: 'Mi Empresa - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username,
        usuarioData: req.session.usuario
    });
});

// ===== VERIFICAR SESIÓN =====
app.get('/api/verificar-sesion', (req, res) => {
    res.json({
        sessionID: req.sessionID,
        session: req.session,
        usuario: req.session?.usuario || null
    });
});

// ===== INICIAR SERVIDOR =====
app.listen(PORT, async () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    await testConnection();
});