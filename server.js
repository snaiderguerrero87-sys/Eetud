const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2');
const fs = require('fs');
require('dotenv').config();

const { pool, testConnection } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIGURACIONES =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== POOL DEDICADO PARA SESIONES =====
const sessionPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: false }
});

// ===== SESIONES EN MYSQL =====
const sessionStore = new MySQLStore({
    createDatabaseTable: true,
    expiration: 86400000,
    clearExpired: true,
    checkExpirationInterval: 900000,
    endConnectionOnClose: false
}, sessionPool);

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'eetud_secret_key_2026_muy_segura',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false, httpOnly: true, sameSite: 'lax' }
}));

// ===== MIDDLEWARE LOG =====
app.use((req, res, next) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📡', req.method, req.url);
    console.log('👤', req.session?.usuario?.username || '❌ No autenticado');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    next();
});

// ===== MIDDLEWARE AUTH =====
function verificarAutenticacion(req, res, next) {
    if (req.session && req.session.usuario) next();
    else res.redirect('/login');
}

function verificarAutenticacionApi(req, res, next) {
    if (req.session && req.session.usuario) next();
    else res.status(401).json({ error: 'No autenticado' });
}

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// ===== FUNCIÓN AUXILIAR: DIBUJAR LOGO EN PDF (SIN ARCHIVOS) =====
// ============================================================
function dibujarLogoEmpresa(doc, empresa, logoX, logoY, LOGO_WIDTH, LOGO_HEIGHT) {
    console.log('🔍 === DIAGNÓSTICO DEL LOGO ===');
    console.log('   empresa.logo existe:', !!empresa.logo);

    let logoCargado = false;

    if (empresa.logo && typeof empresa.logo === 'string' && empresa.logo.length > 50) {
        console.log('   empresa.logo longitud:', empresa.logo.length);
        console.log('   primeros 60 chars:', empresa.logo.substring(0, 60));

        try {
            let base64Data = null;

            // Caso 1: prefijo data:image/...
            if (empresa.logo.indexOf('data:image') === 0) {
                const matches = empresa.logo.match(/^data:image\/(\w+);base64,(.+)$/);
                if (matches) {
                    base64Data = matches[2];
                    console.log('   ✅ Formato data:image detectado');
                }
            } else {
                base64Data = empresa.logo;
                console.log('   ✅ Base64 puro detectado');
            }

            if (base64Data) {
                const imageBuffer = Buffer.from(base64Data, 'base64');
                console.log('   📦 Buffer creado:', imageBuffer.length, 'bytes');

                if (imageBuffer.length > 100) {
                    try {
                        // ✅ Pasar el buffer DIRECTAMENTE a PDFKit (sin archivos temporales)
                        doc.image(imageBuffer, logoX, logoY, {
                            width: LOGO_WIDTH,
                            height: LOGO_HEIGHT,
                            fit: [LOGO_WIDTH, LOGO_HEIGHT],
                            align: 'center',
                            valign: 'center'
                        });
                        logoCargado = true;
                        console.log('   ✅ Logo insertado correctamente (buffer directo)');
                    } catch (imgError) {
                        console.error('   ❌ Error PDFKit al insertar imagen:', imgError.message);
                    }
                } else {
                    console.log('   ⚠️ Buffer demasiado pequeño');
                }
            } else {
                console.log('   ⚠️ Formato no reconocido');
            }
        } catch (e) {
            console.error('   ❌ Error procesando logo:', e.message);
        }
    } else {
        console.log('   ⚠️ No hay logo (vacío o nulo)');
    }

    if (!logoCargado) {
        console.log('   📌 Mostrando placeholder "(logo vacío)"');
        doc.rect(logoX, logoY, LOGO_WIDTH, LOGO_HEIGHT).stroke('#cbd5e1');
        doc.fontSize(8).font('Helvetica').fillColor('#94a3b8');
        doc.text('(logo vacío)', logoX, logoY + LOGO_HEIGHT / 2 - 5, {
            width: LOGO_WIDTH,
            align: 'center'
        });
    }

    doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
    return logoCargado;
}

// ============================================================
// ===== RUTAS PÚBLICAS =====
// ============================================================

app.get('/', (req, res) => {
    if (req.session && req.session.usuario) return res.redirect('/dashboard');
    res.render('landing', { title: 'Eetud - Software de Planificación de Recursos Empresariales' });
});

app.get('/dashboard', verificarAutenticacion, (req, res) => {
    res.render('dashboard', {
        title: 'Dashboard - Eetud',
        usuario: req.session.usuario.nombreCompleto || req.session.usuario.username,
        usuarioData: req.session.usuario
    });
});

// ============================================================
// ===== AUTENTICACIÓN =====
// ============================================================

app.get('/login', (req, res) => {
    if (req.session && req.session.usuario) res.redirect('/dashboard');
    else res.render('login', { title: 'Iniciar Sesión - Eetud', error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.render('login', { title: 'Iniciar Sesión - Eetud', error: 'Completa todos los campos' });
    try {
        const [rows] = await pool.query(
            'SELECT * FROM usuarios WHERE (username = ? OR email = ?) AND password = ? LIMIT 1',
            [username, username, password]
        );
        if (rows.length === 0) return res.render('login', { title: 'Iniciar Sesión - Eetud', error: 'Usuario o contraseña incorrectos' });
        const usuario = rows[0];
        req.session.usuario = {
            id: usuario.id, username: usuario.username, email: usuario.email,
            telefono: usuario.telefono, nit: usuario.nit,
            nombreCompleto: usuario.nombreCompleto || usuario.username
        };
        req.session.save((err) => {
            if (err) return res.render('login', { title: 'Iniciar Sesión - Eetud', error: 'Error al iniciar sesión' });
            res.redirect('/dashboard');
        });
    } catch (error) {
        res.render('login', { title: 'Iniciar Sesión - Eetud', error: 'Error interno' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.log('Error al cerrar sesión:', err);
        res.redirect('/');
    });
});

app.get('/registro', (req, res) => {
    if (req.session && req.session.usuario) res.redirect('/dashboard');
    else res.render('registro', { title: 'Registro - Eetud', error: null });
});

app.post('/registro', async (req, res) => {
    const { username, nombreCompleto, email, telefono, nit, password, confirmPassword } = req.body;
    if (!username || !email || !telefono || !nit || !password || !confirmPassword) {
        return res.render('registro', { title: 'Registro - Eetud', error: 'Completa todos los campos' });
    }
    if (password !== confirmPassword) {
        return res.render('registro', { title: 'Registro - Eetud', error: 'Las contraseñas no coinciden' });
    }
    if (password.length < 6) {
        return res.render('registro', { title: 'Registro - Eetud', error: 'Mínimo 6 caracteres' });
    }
    try {
        const [result] = await pool.query(
            `INSERT INTO usuarios (username, nombreCompleto, email, telefono, nit, password) VALUES (?, ?, ?, ?, ?, ?)`,
            [username, nombreCompleto || username, email, telefono, nit, password]
        );
        const nuevoId = result.insertId;
        await pool.query(
            `INSERT INTO empresa_info (usuario_id, nombre, nit, telefono, email, direccion, web, descripcion, logo) VALUES (?, ?, ?, ?, ?, '', '', '', '')`,
            [nuevoId, nombreCompleto || username, nit, telefono, email]
        );
        req.session.usuario = { id: nuevoId, username, email, telefono, nit, nombreCompleto: nombreCompleto || username };
        req.session.save(() => res.redirect('/dashboard'));
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.render('registro', { title: 'Registro - Eetud', error: 'Usuario, email o NIT ya registrado' });
        res.render('registro', { title: 'Registro - Eetud', error: 'Error interno' });
    }
});

// ============================================================
// ===== EMPRESA INFO =====
// ============================================================

app.get('/api/empresa-info', verificarAutenticacion, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT nombre, nit, telefono, email, direccion, web, descripcion, logo FROM empresa_info WHERE usuario_id = ? LIMIT 1',
            [req.session.usuario.id]
        );
        if (rows.length === 0) return res.json({});
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/guardar-empresa', verificarAutenticacion, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre, nit, telefono, email, direccion, web, descripcion, logo } = req.body;
        await pool.query(
            `INSERT INTO empresa_info (usuario_id, nombre, nit, telefono, email, direccion, web, descripcion, logo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                nombre = VALUES(nombre), nit = VALUES(nit), telefono = VALUES(telefono),
                email = VALUES(email), direccion = VALUES(direccion), web = VALUES(web),
                descripcion = VALUES(descripcion), logo = VALUES(logo)`,
            [usuarioId, nombre || '', nit || '', telefono || '', email || '', direccion || '', web || '', descripcion || '', logo || '']
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), session: req.session?.usuario?.username || 'no autenticado' });
});

// ============================================================
// ===== DASHBOARD (RESUMEN) =====
// ============================================================

app.get('/api/dashboard/resumen', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;

        const [proyectosRows] = await pool.query(
            'SELECT id, nombre, cliente, avanceTotal, valorTotal, valorEjecutado, saldo FROM proyectos WHERE usuario_id = ? ORDER BY id DESC',
            [usuarioId]
        );
        let totalProyectos = proyectosRows.length;
        let proyectosCompletos = 0;
        let proyectosEnCurso = 0;
        const proyectosCurso = [];

        for (const p of proyectosRows) {
            const avance = parseFloat(p.avanceTotal) || 0;
            if (avance >= 100) {
                proyectosCompletos++;
            } else {
                proyectosEnCurso++;
                proyectosCurso.push({
                    id: p.id, nombre: p.nombre, cliente: p.cliente,
                    avanceTotal: avance, valorTotal: parseFloat(p.valorTotal) || 0
                });
            }
        }

        const [cotizacionesRows] = await pool.query(
            'SELECT COUNT(*) AS total FROM cotizaciones WHERE usuario_id = ?', [usuarioId]
        );
        const totalCotizaciones = cotizacionesRows[0].total;

        const [herramientasRows] = await pool.query(
            'SELECT COUNT(*) AS total FROM herramientas WHERE usuario_id = ?', [usuarioId]
        );
        const totalHerramientas = herramientasRows[0].total;

        const [proyectosHerrRows] = await pool.query(
            'SELECT herramientasObra FROM proyectos WHERE usuario_id = ?', [usuarioId]
        );
        let herramientasEnObra = 0;
        const idsHerramientasEnObra = [];

        for (const row of proyectosHerrRows) {
            let herrs = row.herramientasObra;
            if (typeof herrs === 'string') {
                try { herrs = JSON.parse(herrs); } catch (e) { herrs = []; }
            }
            if (Array.isArray(herrs)) {
                for (const h of herrs) {
                    if (!h.fechaSalida) {
                        herramientasEnObra++;
                        idsHerramientasEnObra.push(h.herramientaId);
                    }
                }
            }
        }
        const herramientasDisponibles = totalHerramientas - herramientasEnObra;

        let detalleHerramientasObra = [];
        if (idsHerramientasEnObra.length > 0) {
            const [herrInfo] = await pool.query(
                'SELECT id, nombre, codigo, marca FROM herramientas WHERE usuario_id = ? AND id IN (?)',
                [usuarioId, idsHerramientasEnObra]
            );
            detalleHerramientasObra = herrInfo.map(h => ({ nombre: h.nombre, codigo: h.codigo, marca: h.marca }));
        }

        const [empleadosRows] = await pool.query(
            'SELECT COUNT(*) AS total FROM empleados WHERE usuario_id = ?', [usuarioId]
        );
        const totalEmpleados = empleadosRows[0].total;

        const [proyectosEmpRows] = await pool.query(
            'SELECT empleadosObra FROM proyectos WHERE usuario_id = ?', [usuarioId]
        );
        const idsEmpleadosEnObra = new Set();
        for (const row of proyectosEmpRows) {
            let emps = row.empleadosObra;
            if (typeof emps === 'string') {
                try { emps = JSON.parse(emps); } catch (e) { emps = []; }
            }
            if (Array.isArray(emps)) {
                for (const e of emps) {
                    if (e.empleadoId) idsEmpleadosEnObra.add(e.empleadoId);
                }
            }
        }
        const empleadosEnObra = idsEmpleadosEnObra.size;
        const empleadosDisponibles = totalEmpleados - empleadosEnObra;

        let detalleEmpleadosObra = [];
        if (empleadosEnObra > 0) {
            const [empInfo] = await pool.query(
                'SELECT id, nombre, cargo FROM empleados WHERE usuario_id = ? AND id IN (?)',
                [usuarioId, Array.from(idsEmpleadosEnObra)]
            );
            detalleEmpleadosObra = empInfo.map(e => ({ nombre: e.nombre, cargo: e.cargo }));
        }

        res.json({
            proyectos: { total: totalProyectos, completos: proyectosCompletos, enCurso: proyectosEnCurso, lista: proyectosCurso.slice(0, 10) },
            cotizaciones: { total: totalCotizaciones },
            herramientas: { total: totalHerramientas, enObra: herramientasEnObra, disponibles: herramientasDisponibles, detalleEnObra: detalleHerramientasObra.slice(0, 10) },
            empleados: { total: totalEmpleados, enObra: empleadosEnObra, disponibles: empleadosDisponibles, detalleEnObra: detalleEmpleadosObra.slice(0, 10) }
        });
    } catch (error) {
        console.error('❌ Error al generar resumen:', error);
        res.status(500).json({ error: 'Error al generar resumen' });
    }
});

// ============================================================
// ===== HERRAMIENTAS =====
// ============================================================

app.get('/api/herramientas', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, codigo, nombre, marca, ubicacion FROM herramientas WHERE usuario_id = ? ORDER BY id DESC',
            [req.session.usuario.id]
        );
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/herramientas', verificarAutenticacionApi, async (req, res) => {
    try {
        const { codigo, nombre, marca } = req.body;
        if (!codigo || !nombre || !marca) return res.status(400).json({ error: 'Campos obligatorios' });
        const [result] = await pool.query(
            'INSERT INTO herramientas (usuario_id, codigo, nombre, marca, ubicacion) VALUES (?, ?, ?, ?, ?)',
            [req.session.usuario.id, codigo, nombre, marca, '']
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/herramientas/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const { codigo, nombre, marca } = req.body;
        const [result] = await pool.query(
            'UPDATE herramientas SET codigo = ?, nombre = ?, marca = ? WHERE id = ? AND usuario_id = ?',
            [codigo, nombre, marca, parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/herramientas/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM herramientas WHERE id = ? AND usuario_id = ?',
            [parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ============================================================
// ===== EMPLEADOS =====
// ============================================================

app.get('/api/empleados', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nombre, cargo, costoDia, costoMes, costoHora FROM empleados WHERE usuario_id = ? ORDER BY id DESC',
            [req.session.usuario.id]
        );
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/empleados', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre, cargo, costoDia } = req.body;
        if (!nombre || !cargo || !costoDia) return res.status(400).json({ error: 'Campos obligatorios' });
        const cd = parseFloat(costoDia);
        const [result] = await pool.query(
            'INSERT INTO empleados (usuario_id, nombre, cargo, costoDia, costoMes, costoHora) VALUES (?, ?, ?, ?, ?, ?)',
            [req.session.usuario.id, nombre, cargo, cd, cd * 30, cd / 8]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/empleados/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre, cargo, costoDia } = req.body;
        const cd = parseFloat(costoDia);
        const [result] = await pool.query(
            'UPDATE empleados SET nombre = ?, cargo = ?, costoDia = ?, costoMes = ?, costoHora = ? WHERE id = ? AND usuario_id = ?',
            [nombre, cargo, cd, cd * 30, cd / 8, parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/empleados/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM empleados WHERE id = ? AND usuario_id = ?',
            [parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ============================================================
// ===== MATERIALES =====
// ============================================================

app.get('/api/materiales', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nombre, proveedor, unidad, precio FROM materiales WHERE usuario_id = ? ORDER BY id DESC',
            [req.session.usuario.id]
        );
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/materiales', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre, proveedor, unidad, precio } = req.body;
        if (!nombre || !proveedor || !unidad || !precio) return res.status(400).json({ error: 'Campos obligatorios' });
        const [result] = await pool.query(
            'INSERT INTO materiales (usuario_id, nombre, proveedor, unidad, precio) VALUES (?, ?, ?, ?, ?)',
            [req.session.usuario.id, nombre, proveedor, unidad, parseFloat(precio)]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/materiales/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre, proveedor, unidad, precio } = req.body;
        const [result] = await pool.query(
            'UPDATE materiales SET nombre = ?, proveedor = ?, unidad = ?, precio = ? WHERE id = ? AND usuario_id = ?',
            [nombre, proveedor, unidad, parseFloat(precio), parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/materiales/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM materiales WHERE id = ? AND usuario_id = ?',
            [parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/materiales/exportar-formato', verificarAutenticacionApi, (req, res) => {
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
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/materiales/importar', verificarAutenticacionApi, (req, res) => {
    try {
        const XLSX = require('xlsx');
        const { file } = req.body;
        if (!file) return res.status(400).json({ error: 'No se recibió archivo' });
        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if (data.length === 0) return res.status(400).json({ error: 'Archivo vacío' });

        const headers = Object.keys(data[0]);
        const req_headers = ['Nombre', 'Proveedor', 'Unidad', 'Precio Unitario'];
        const missing = req_headers.filter(h => !headers.includes(h));
        if (missing.length > 0) return res.status(400).json({ error: 'Faltan columnas: ' + missing.join(', ') });

        const materiales = [];
        const errores = [];
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
            materiales.push({ nombre, proveedor, unidad, precio });
        }
        if (errores.length > 0) return res.status(400).json({ error: 'Errores', detalles: errores });
        res.json({ success: true, materiales });
    } catch (error) { res.status(500).json({ error: 'Error al importar' }); }
});

app.post('/api/materiales/importar-lote', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { materiales } = req.body;
        if (!Array.isArray(materiales) || materiales.length === 0) return res.status(400).json({ error: 'Sin materiales' });
        const values = materiales.map(m => [usuarioId, m.nombre || '', m.proveedor || '', m.unidad || '', parseFloat(m.precio) || 0]);
        await pool.query('INSERT INTO materiales (usuario_id, nombre, proveedor, unidad, precio) VALUES ?', [values]);
        res.json({ success: true, message: `${materiales.length} importados` });
    } catch (error) { res.status(500).json({ error: 'Error al importar' }); }
});

// ============================================================
// ===== APUS =====
// ============================================================

app.get('/api/apus', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual FROM apus WHERE usuario_id = ? ORDER BY id DESC',
            [req.session.usuario.id]
        );
        const apus = rows.map(r => ({
            ...r,
            items: r.items ? (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) : { materiales: [], equipos: [], transporte: [], cargos: [] },
            ignorarItems: r.ignorarItems === 1 || r.ignorarItems === true
        }));
        res.json(apus);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/apus', verificarAutenticacionApi, async (req, res) => {
    try {
        const { codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual } = req.body;
        if (!codigo || !nombre || !categoria || !unidad) return res.status(400).json({ error: 'Campos obligatorios' });
        const itemsJson = JSON.stringify(items || { materiales: [], equipos: [], transporte: [], cargos: [] });
        const [result] = await pool.query(
            `INSERT INTO apus (usuario_id, codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.session.usuario.id, codigo, nombre, categoria, unidad, parseFloat(valor) || 0, itemsJson, ignorarItems ? 1 : 0, parseFloat(valorManual) || 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/apus/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const { codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual } = req.body;
        const itemsJson = JSON.stringify(items || { materiales: [], equipos: [], transporte: [], cargos: [] });
        const [result] = await pool.query(
            `UPDATE apus SET codigo = ?, nombre = ?, categoria = ?, unidad = ?, valor = ?, items = ?, ignorarItems = ?, valorManual = ? WHERE id = ? AND usuario_id = ?`,
            [codigo, nombre, categoria, unidad, parseFloat(valor) || 0, itemsJson, ignorarItems ? 1 : 0, parseFloat(valorManual) || 0, parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/apus/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM apus WHERE id = ? AND usuario_id = ?',
            [parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/apus/categorias', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nombre FROM categorias_apu WHERE usuario_id = ? ORDER BY nombre ASC',
            [req.session.usuario.id]
        );
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/apus/categorias', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
        await pool.query('INSERT IGNORE INTO categorias_apu (usuario_id, nombre) VALUES (?, ?)', [req.session.usuario.id, nombre.trim()]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/apus/categorias/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre } = req.body;
        await pool.query('UPDATE categorias_apu SET nombre = ? WHERE id = ? AND usuario_id = ?', [nombre.trim(), parseInt(req.params.id), req.session.usuario.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/apus/categorias/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        await pool.query('DELETE FROM categorias_apu WHERE id = ? AND usuario_id = ?', [parseInt(req.params.id), req.session.usuario.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/apus/unidades', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, nombre FROM unidades_apu WHERE usuario_id = ? ORDER BY nombre ASC',
            [req.session.usuario.id]
        );
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/apus/unidades', verificarAutenticacionApi, async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
        await pool.query('INSERT IGNORE INTO unidades_apu (usuario_id, nombre) VALUES (?, ?)', [req.session.usuario.id, nombre.trim().toUpperCase()]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/apus/exportar-formato', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const ExcelJS = require('exceljs');
        const [unidadesRows] = await pool.query('SELECT nombre FROM unidades_apu WHERE usuario_id = ? ORDER BY nombre ASC', [usuarioId]);
        let unidadesGuardadas = unidadesRows.map(r => r.nombre);
        if (unidadesGuardadas.length === 0) unidadesGuardadas = ['und', 'm', 'm2', 'm3', 'kg', 'ml', 'hr', 'dia'];

        const workbook = new ExcelJS.Workbook();
        const listasSheet = workbook.addWorksheet('Listas');
        listasSheet.state = 'hidden';
        listasSheet.getCell('B1').value = 'UNIDADES';
        listasSheet.getCell('B1').font = { bold: true };
        unidadesGuardadas.forEach((u, i) => { listasSheet.getCell(`B${i + 2}`).value = u; });
        listasSheet.getColumn(2).width = 20;

        const worksheet = workbook.addWorksheet('APU');
        worksheet.columns = [
            { header: 'Código', width: 12 }, { header: 'Nombre', width: 25 }, { header: 'Categoría', width: 25 }, { header: 'Unidad', width: 10 },
            { header: 'Nombre del Equipo/Herramienta', width: 30 }, { header: 'Unidad Equipo (%)', width: 18 }, { header: 'Porcentaje (%)', width: 15 }, { header: 'Valor Base Equipo', width: 18 },
            { header: 'Nombre del Transporte', width: 30 }, { header: 'Unidad Transporte (%)', width: 18 }, { header: 'Porcentaje Transporte (%)', width: 15 }, { header: 'Valor Base Transporte', width: 18 },
            { header: 'Descripción Mano de Obra', width: 30 }, { header: 'Unidad Mano de Obra', width: 18 }, { header: 'Cantidad Mano de Obra', width: 15 }, { header: 'Valor Unitario Mano de Obra', width: 18 }
        ];
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002735' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 25;

        const data = [
            ['A001', 'Excavación Manual', 'Movimiento de Tierra', 'm3', 'Excavadora', '%', '15', '50000', 'Flete', '%', '10', '30000', 'Oficial', 'und', '2', '80000'],
            ['A001', 'Excavación Manual', 'Movimiento de Tierra', 'm3', '', '%', '', '', '', '%', '', '', 'Ayudante', 'und', '4', '50000']
        ];
        data.forEach(row => worksheet.addRow(row));

        for (let r = 2; r <= data.length + 1; r++) {
            worksheet.getCell(`D${r}`).dataValidation = { type: 'list', formulae: ['=Listas!B:B'], showErrorMessage: true, errorTitle: 'Inválido', error: 'Selecciona una unidad' };
        }

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=formato_apu.xlsx');
        res.send(buffer);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/apus/importar', verificarAutenticacionApi, async (req, res) => {
    try {
        const XLSX = require('xlsx');
        const usuarioId = req.session.usuario.id;
        const { file } = req.body;
        if (!file) return res.status(400).json({ error: 'No se recibió archivo' });

        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let worksheet = workbook.Sheets['APU'];
        if (!worksheet) {
            for (let i = 0; i < workbook.SheetNames.length; i++) {
                const ts = workbook.Sheets[workbook.SheetNames[i]];
                if (XLSX.utils.sheet_to_json(ts, { defval: '' }).length > 0) { worksheet = ts; break; }
            }
        }
        if (!worksheet) return res.status(400).json({ error: 'No hay hoja APU' });

        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        const data = rawData.map(row => {
            const nr = {};
            Object.keys(row).forEach(k => { nr[k.trim()] = row[k]; });
            return nr;
        });
        if (data.length === 0) return res.status(400).json({ error: 'Archivo vacío' });

        const headers = Object.keys(data[0]);
        const req_headers = ['Código', 'Nombre', 'Categoría', 'Unidad'];
        const missing = req_headers.filter(h => !headers.includes(h));
        if (missing.length > 0) return res.status(400).json({ error: 'Faltan columnas: ' + missing.join(', ') });

        const [categoriasRows] = await pool.query('SELECT nombre FROM categorias_apu WHERE usuario_id = ?', [usuarioId]);
        let categoriasExistentes = categoriasRows.map(r => r.nombre);

        function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
        function num(v) { if (!v) return 0; if (typeof v === 'number') return v; return parseFloat(String(v).replace(/[€£¥$.,\s]/g, '')) || 0; }

        const apusMap = {};
        let errores = [];
        let categoriasNuevas = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const filaNum = i + 2;
            const codigo = str(row['Código']);
            const nombre = str(row['Nombre']);
            const categoria = str(row['Categoría']);
            const unidad = str(row['Unidad']).toUpperCase();

            if (!codigo || !nombre || !categoria || !unidad) {
                errores.push(`Fila ${filaNum}: Campos obligatorios vacíos`);
                continue;
            }
            if (!categoriasExistentes.some(c => c.toLowerCase() === categoria.toLowerCase())) {
                if (!categoriasNuevas.includes(categoria)) categoriasNuevas.push(categoria);
            }
            if (!apusMap[codigo]) {
                apusMap[codigo] = { codigo, nombre, categoria, unidad, items: { materiales: [], equipos: [], transporte: [], cargos: [] } };
            }

            const ne = str(row['Nombre del Equipo/Herramienta']);
            if (ne) {
                const p = num(row['Porcentaje (%)']);
                const vb = num(row['Valor Base Equipo']);
                apusMap[codigo].items.equipos.push({ nombre: ne, unidad: '%', porcentaje: p, valorBase: vb, subtotal: (p / 100) * vb });
            }
            const nt = str(row['Nombre del Transporte']);
            if (nt) {
                const p = num(row['Porcentaje Transporte (%)']);
                const vb = num(row['Valor Base Transporte']);
                apusMap[codigo].items.transporte.push({ nombre: nt, unidad: '%', porcentaje: p, valorBase: vb, subtotal: (p / 100) * vb });
            }
            const dm = str(row['Descripción Mano de Obra']);
            if (dm) {
                const um = str(row['Unidad Mano de Obra']) || 'und';
                const cm = num(row['Cantidad Mano de Obra']);
                const vu = num(row['Valor Unitario Mano de Obra']);
                apusMap[codigo].items.cargos.push({ descripcion: dm, unidad: um, cantidad: cm, valorUnitario: vu, subtotal: cm * vu });
            }
        }

        if (errores.length > 0) return res.status(400).json({ success: false, error: 'Errores', detalles: errores });

        let apusImportados = 0;
        for (const codigo in apusMap) {
            const apu = apusMap[codigo];
            let valorTotal = 0;
            apu.items.equipos.forEach(e => { valorTotal += e.subtotal; });
            apu.items.transporte.forEach(t => { valorTotal += t.subtotal; });
            apu.items.cargos.forEach(c => { valorTotal += c.subtotal; });

            await pool.query(
                `INSERT INTO apus (usuario_id, codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
                [usuarioId, apu.codigo, apu.nombre, apu.categoria, apu.unidad, valorTotal, JSON.stringify(apu.items)]
            );
            apusImportados++;
        }

        for (const cat of categoriasNuevas) {
            await pool.query('INSERT IGNORE INTO categorias_apu (usuario_id, nombre) VALUES (?, ?)', [usuarioId, cat]);
        }
        const unidadesSet = new Set();
        for (const codigo in apusMap) unidadesSet.add(apusMap[codigo].unidad);
        for (const uni of unidadesSet) {
            await pool.query('INSERT IGNORE INTO unidades_apu (usuario_id, nombre) VALUES (?, ?)', [usuarioId, uni]);
        }

        res.json({ success: true, message: `${apusImportados} APUs importados`, apusImportados, categoriasNuevas });
    } catch (error) { res.status(500).json({ error: 'Error al importar' }); }
});

// ============================================================
// ===== COTIZACIONES =====
// ============================================================

app.get('/api/cotizaciones', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, numero, cliente, tipo, proyecto, objetivo, direccion, valorTotal, valorTotalFinal, items, ajustes, fecha FROM cotizaciones WHERE usuario_id = ? ORDER BY id DESC',
            [req.session.usuario.id]
        );
        const cotizaciones = rows.map(r => ({
            ...r,
            items: r.items ? (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) : [],
            ajustes: r.ajustes ? (typeof r.ajustes === 'string' ? JSON.parse(r.ajustes) : r.ajustes) : {}
        }));
        res.json(cotizaciones);
    } catch (error) { res.status(500).json({ error: 'Error al listar cotizaciones' }); }
});

app.post('/api/cotizaciones', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { numero, cliente, tipo, proyecto, objetivo, direccion, valorTotal, valorTotalFinal, items, ajustes } = req.body;
        if (!cliente || !tipo || !proyecto) return res.status(400).json({ error: 'Cliente, tipo y proyecto obligatorios' });

        const [result] = await pool.query(
            `INSERT INTO cotizaciones (usuario_id, numero, cliente, tipo, proyecto, objetivo, direccion, valorTotal, valorTotalFinal, items, ajustes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [usuarioId, numero || '', cliente, tipo, proyecto, objetivo || '', direccion || '', parseFloat(valorTotal) || 0, parseFloat(valorTotalFinal) || 0, JSON.stringify(items || []), JSON.stringify(ajustes || {})]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Error al crear cotización' }); }
});

app.put('/api/cotizaciones/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { numero, cliente, tipo, proyecto, objetivo, direccion, valorTotal, valorTotalFinal, items, ajustes } = req.body;

        const [result] = await pool.query(
            `UPDATE cotizaciones SET numero = ?, cliente = ?, tipo = ?, proyecto = ?, objetivo = ?, direccion = ?, valorTotal = ?, valorTotalFinal = ?, items = ?, ajustes = ?
             WHERE id = ? AND usuario_id = ?`,
            [numero || '', cliente, tipo, proyecto, objetivo || '', direccion || '', parseFloat(valorTotal) || 0, parseFloat(valorTotalFinal) || 0, JSON.stringify(items || []), JSON.stringify(ajustes || {}), id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al actualizar' }); }
});

app.delete('/api/cotizaciones/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM cotizaciones WHERE id = ? AND usuario_id = ?',
            [parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ============================================================
// ===== PROYECTOS =====
// ============================================================

app.get('/api/proyectos', verificarAutenticacionApi, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, nombre, cliente, cotizacionId, cotizacionNumero, items, ajustes, avanceTotal, valorTotal, valorEjecutado, saldo, herramientasObra, empleadosObra, compras, fechaCreacion
             FROM proyectos WHERE usuario_id = ? ORDER BY id DESC`,
            [req.session.usuario.id]
        );
        const proyectos = rows.map(r => ({
            ...r,
            items: r.items ? (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) : [],
            ajustes: r.ajustes ? (typeof r.ajustes === 'string' ? JSON.parse(r.ajustes) : r.ajustes) : {},
            herramientasObra: r.herramientasObra ? (typeof r.herramientasObra === 'string' ? JSON.parse(r.herramientasObra) : r.herramientasObra) : [],
            empleadosObra: r.empleadosObra ? (typeof r.empleadosObra === 'string' ? JSON.parse(r.empleadosObra) : r.empleadosObra) : [],
            compras: r.compras ? (typeof r.compras === 'string' ? JSON.parse(r.compras) : r.compras) : []
        }));
        res.json(proyectos);
    } catch (error) { res.status(500).json({ error: 'Error al listar proyectos' }); }
});

app.post('/api/proyectos', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre, cliente, cotizacionId, cotizacionNumero, items, ajustes, avanceTotal, valorTotal, valorEjecutado, saldo, herramientasObra, empleadosObra, compras } = req.body;

        if (!nombre || !cliente) return res.status(400).json({ error: 'Nombre y cliente obligatorios' });

        const [result] = await pool.query(
            `INSERT INTO proyectos (usuario_id, nombre, cliente, cotizacionId, cotizacionNumero, items, ajustes, avanceTotal, valorTotal, valorEjecutado, saldo, herramientasObra, empleadosObra, compras)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                usuarioId, nombre, cliente,
                cotizacionId || null, cotizacionNumero || '',
                JSON.stringify(items || []),
                JSON.stringify(ajustes || {}),
                parseFloat(avanceTotal) || 0,
                parseFloat(valorTotal) || 0,
                parseFloat(valorEjecutado) || 0,
                parseFloat(saldo) || 0,
                JSON.stringify(herramientasObra || []),
                JSON.stringify(empleadosObra || []),
                JSON.stringify(compras || [])
            ]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ error: 'Error al crear proyecto' }); }
});

app.put('/api/proyectos/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { nombre, cliente, cotizacionId, cotizacionNumero, items, ajustes, avanceTotal, valorTotal, valorEjecutado, saldo, herramientasObra, empleadosObra, compras } = req.body;

        const [result] = await pool.query(
            `UPDATE proyectos SET nombre = ?, cliente = ?, cotizacionId = ?, cotizacionNumero = ?, items = ?, ajustes = ?, avanceTotal = ?, valorTotal = ?, valorEjecutado = ?, saldo = ?, herramientasObra = ?, empleadosObra = ?, compras = ?
             WHERE id = ? AND usuario_id = ?`,
            [
                nombre, cliente,
                cotizacionId || null, cotizacionNumero || '',
                JSON.stringify(items || []),
                JSON.stringify(ajustes || {}),
                parseFloat(avanceTotal) || 0,
                parseFloat(valorTotal) || 0,
                parseFloat(valorEjecutado) || 0,
                parseFloat(saldo) || 0,
                JSON.stringify(herramientasObra || []),
                JSON.stringify(empleadosObra || []),
                JSON.stringify(compras || []),
                id, usuarioId
            ]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error al actualizar proyecto' }); }
});

app.delete('/api/proyectos/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM proyectos WHERE id = ? AND usuario_id = ?',
            [parseInt(req.params.id), req.session.usuario.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ============================================================
// ===== PDF APU =====
// ============================================================

app.get('/api/apu-pdf/:id', verificarAutenticacion, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const apuId = parseInt(req.params.id);
        const usuarioId = req.session.usuario.id;

        const [apuRows] = await pool.query('SELECT * FROM apus WHERE id = ? AND usuario_id = ? LIMIT 1', [apuId, usuarioId]);
        if (apuRows.length === 0) return res.status(404).json({ error: 'APU no encontrado' });

        const apuData = apuRows[0];
        apuData.items = apuData.items ? (typeof apuData.items === 'string' ? JSON.parse(apuData.items) : apuData.items) : { materiales: [], equipos: [], transporte: [], cargos: [] };

        let empresaData = {};
        const [empresas] = await pool.query(
            'SELECT nombre, nit, telefono, email, direccion, web, descripcion, logo FROM empresa_info WHERE usuario_id = ? LIMIT 1',
            [usuarioId]
        );
        if (empresas.length > 0) empresaData = empresas[0];

        const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `APU - ${apuData.codigo}`, Author: empresaData.nombre || 'Eetud', Subject: 'APU' } });

        const filename = `APU_${apuData.codigo}_${new Date().toISOString().slice(0,10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        doc.pipe(res);

        function fp(v) { return '$' + Number(v).toLocaleString('es-CO'); }
        function ff() { const a = new Date(); return a.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

        const pageWidth = doc.page.width - 80;
        let currentY = 40;

        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(40, currentY, pageWidth, 90).stroke();

        // ===== LOGO O PLACEHOLDER (SIN ARCHIVO TEMPORAL) =====
        const LOGO_WIDTH = 65;
        const LOGO_HEIGHT = 65;
        let logoX = 55;
        let logoY = currentY + 10;

        dibujarLogoEmpresa(doc, empresaData, logoX, logoY, LOGO_WIDTH, LOGO_HEIGHT);

        let tx = logoX + LOGO_WIDTH + 15;
        let ty = currentY + 12;
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#002735');
        doc.text((empresaData.nombre || 'MI EMPRESA').toUpperCase(), tx, ty);
        ty += 20;
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        if (empresaData.nit) { doc.text(`NIT: ${empresaData.nit}`, tx, ty); ty += 14; }
        if (empresaData.direccion) { doc.text(`Dirección: ${empresaData.direccion}`, tx, ty); ty += 14; }
        if (empresaData.telefono) { doc.text(`Teléfono: ${empresaData.telefono}`, tx, ty); ty += 14; }
        if (empresaData.email) { doc.text(`Email: ${empresaData.email}`, tx, ty); ty += 14; }

        const fechaTexto = `Fecha de emisión: ${ff()}`;
        const fw = doc.widthOfString(fechaTexto);
        doc.text(fechaTexto, doc.page.width - 50 - fw, currentY + 12);

        currentY += 95;
        doc.strokeColor('#002735').lineWidth(1.5);
        doc.moveTo(40, currentY).lineTo(doc.page.width - 40, currentY).stroke();
        currentY += 10;

        doc.fontSize(22).font('Helvetica-Bold').fillColor('#002735');
        const tit = 'ANÁLISIS DE PRECIOS UNITARIOS';
        const tw = doc.widthOfString(tit);
        doc.text(tit, (doc.page.width - tw) / 2, currentY);
        currentY += 30;

        doc.fillColor('#002735');
        doc.rect(50, currentY, pageWidth, 25).fill();
        doc.fillColor('white').fontSize(12).font('Helvetica-Bold');
        doc.text('INFORMACIÓN APU', 55, currentY + 7);
        currentY += 29;

        doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
        const campos = [
            { l: 'Código', v: apuData.codigo || '-' },
            { l: 'Nombre', v: apuData.nombre || '-' },
            { l: 'Categoría', v: apuData.categoria || '-' },
            { l: 'Unidad', v: apuData.unidad || '-' },
            { l: 'Valor Unitario', v: fp(apuData.valor || 0) }
        ];
        for (let i = 0; i < campos.length; i++) {
            if (currentY > doc.page.height - 100) { doc.addPage(); currentY = 50; }
            if (i % 2 === 0) { doc.fillColor('#f8fafc'); doc.rect(50, currentY - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
            doc.text(campos[i].l + ':', 55, currentY);
            doc.text(campos[i].v, 200, currentY);
            currentY += 16;
        }
        doc.strokeColor('#e2e8f0').lineWidth(1);
        doc.moveTo(50, currentY - 4).lineTo(doc.page.width - 40, currentY - 4).stroke();
        currentY += 10;

        const equipos = apuData.items?.equipos || [];
        if (equipos.length > 0) {
            const colX = [50, 180, 280, 380, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('EQUIPOS Y HERRAMIENTAS', 50, y); y += 18;
            doc.fillColor('#002735'); doc.rect(50, y, pageWidth, 20).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('NOMBRE', colX[0] + 5, y + 5);
            doc.text('UNIDAD', colX[1] + 5, y + 5);
            doc.text('PORCENTAJE', colX[2] + 5, y + 5);
            doc.text('VALOR BASE', colX[3] + 5, y + 5);
            doc.text('SUBTOTAL', colX[4] + 5, y + 5);
            y += 20;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
            let sub = 0;
            for (let i = 0; i < equipos.length; i++) {
                const e = equipos[i];
                sub += e.subtotal || 0;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) { doc.fillColor('#f8fafc'); doc.rect(50, y - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
                doc.text((e.nombre || '').substring(0, 20), colX[0] + 5, y);
                doc.text(e.unidad || '%', colX[1] + 5, y);
                doc.text((e.porcentaje || 0) + '%', colX[2] + 5, y);
                doc.text(fp(e.valorBase || 0), colX[3] + 5, y);
                doc.text(fp(e.subtotal || 0), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const t = `Subtotal Equipos y Herramientas: ${fp(sub)}`;
            doc.text(t, doc.page.width - 50 - doc.widthOfString(t), y);
            currentY = y + 20;
        }

        const transportes = apuData.items?.transporte || [];
        if (transportes.length > 0) {
            const colX = [50, 180, 280, 380, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('TRANSPORTE DE MATERIALES', 50, y); y += 18;
            doc.fillColor('#002735'); doc.rect(50, y, pageWidth, 20).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('NOMBRE', colX[0] + 5, y + 5);
            doc.text('UNIDAD', colX[1] + 5, y + 5);
            doc.text('PORCENTAJE', colX[2] + 5, y + 5);
            doc.text('VALOR BASE', colX[3] + 5, y + 5);
            doc.text('SUBTOTAL', colX[4] + 5, y + 5);
            y += 20;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
            let sub = 0;
            for (let i = 0; i < transportes.length; i++) {
                const t = transportes[i];
                sub += t.subtotal || 0;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) { doc.fillColor('#f8fafc'); doc.rect(50, y - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
                doc.text((t.nombre || '').substring(0, 20), colX[0] + 5, y);
                doc.text(t.unidad || '%', colX[1] + 5, y);
                doc.text((t.porcentaje || 0) + '%', colX[2] + 5, y);
                doc.text(fp(t.valorBase || 0), colX[3] + 5, y);
                doc.text(fp(t.subtotal || 0), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const t = `Subtotal Transporte: ${fp(sub)}`;
            doc.text(t, doc.page.width - 50 - doc.widthOfString(t), y);
            currentY = y + 20;
        }

        const cargos = apuData.items?.cargos || [];
        if (cargos.length > 0) {
            const colX = [50, 200, 320, 420, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('MANO DE OBRA', 50, y); y += 18;
            doc.fillColor('#002735'); doc.rect(50, y, pageWidth, 20).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('DESCRIPCIÓN', colX[0] + 5, y + 5);
            doc.text('UNIDAD', colX[1] + 5, y + 5);
            doc.text('CANTIDAD', colX[2] + 5, y + 5);
            doc.text('VALOR UNIT.', colX[3] + 5, y + 5);
            doc.text('SUBTOTAL', colX[4] + 5, y + 5);
            y += 20;
            doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
            let sub = 0;
            for (let i = 0; i < cargos.length; i++) {
                const c = cargos[i];
                const s = c.subtotal || (c.valorUnitario * c.cantidad);
                sub += s;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) { doc.fillColor('#f8fafc'); doc.rect(50, y - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
                doc.text((c.descripcion || '').substring(0, 20), colX[0] + 5, y);
                doc.text(c.unidad || 'und', colX[1] + 5, y);
                doc.text(String(c.cantidad || 0), colX[2] + 5, y);
                doc.text(fp(c.valorUnitario || 0), colX[3] + 5, y);
                doc.text(fp(s), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const t = `Subtotal Mano de Obra: ${fp(sub)}`;
            doc.text(t, doc.page.width - 50 - doc.widthOfString(t), y);
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
        const tv = fp(apuData.valor || 0);
        doc.text(tv, doc.page.width - 50 - doc.widthOfString(tv) - 10, totalY + 10);

        doc.end();
    } catch (error) {
        console.error('❌ Error PDF APU:', error);
        res.status(500).json({ error: 'Error al generar PDF' });
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

        console.log('📄 === GENERANDO PDF COTIZACIÓN ===');
        console.log('📋 Cotización:', cotizacion.numero);
        console.log('🏢 Empresa:', empresa ? empresa.nombre : 'undefined');
        console.log('🖼️ Logo en body:', empresa && empresa.logo ? 'SÍ (' + empresa.logo.length + ' chars)' : 'NO');

        const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Cotización ${cotizacion.numero}`, Author: empresa.nombre || 'Eetud', Subject: 'Cotización' } });

        const filename = `Cotizacion_${cotizacion.numero}_${new Date().toISOString().slice(0,10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        doc.pipe(res);

        function fp(v) { return '$' + Number(v).toLocaleString('es-CO'); }
        function ff() { const a = new Date(); return a.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

        const MARGEN_IZQ = 40;
        const MARGEN_DER = doc.page.width - 40;
        const pageWidth = MARGEN_DER - MARGEN_IZQ;
        let currentY = 40;

        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, currentY, pageWidth, 90).stroke();

        // ===== LOGO O PLACEHOLDER (SIN ARCHIVO TEMPORAL) =====
        const LOGO_WIDTH = 65;
        const LOGO_HEIGHT = 65;
        let logoX = MARGEN_IZQ + 15;
        let logoY = currentY + 10;

        dibujarLogoEmpresa(doc, empresa, logoX, logoY, LOGO_WIDTH, LOGO_HEIGHT);

        let tx = logoX + LOGO_WIDTH + 15;
        let ty = currentY + 12;
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#002735');
        doc.text((empresa.nombre || 'MI EMPRESA').toUpperCase(), tx, ty);
        ty += 20;
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        if (empresa.nit) { doc.text(`NIT: ${empresa.nit}`, tx, ty); ty += 14; }
        if (empresa.direccion) { doc.text(`Dirección: ${empresa.direccion}`, tx, ty); ty += 14; }
        if (empresa.telefono) { doc.text(`Teléfono: ${empresa.telefono}`, tx, ty); ty += 14; }
        if (empresa.email) { doc.text(`Email: ${empresa.email}`, tx, ty); ty += 14; }
        if (empresa.web) { doc.text(`Web: ${empresa.web}`, tx, ty); ty += 14; }

        const fechaTexto = `Fecha de emisión: ${ff()}`;
        const fw = doc.widthOfString(fechaTexto);
        doc.text(fechaTexto, MARGEN_DER - fw, currentY + 12);

        currentY += 95;
        doc.strokeColor('#002735').lineWidth(1.5);
        doc.moveTo(MARGEN_IZQ, currentY).lineTo(MARGEN_DER, currentY).stroke();
        currentY += 20;

        doc.fontSize(22).font('Helvetica-Bold').fillColor('#002735');
        const tit = 'COTIZACIÓN';
        const tw = doc.widthOfString(tit);
        doc.text(tit, (doc.page.width - tw) / 2, currentY);
        currentY += 40;

        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, currentY, pageWidth, 25).fill();
        doc.fillColor('white').fontSize(12).font('Helvetica-Bold');
        doc.text('INFORMACIÓN DE LA COTIZACIÓN', MARGEN_IZQ + 5, currentY + 7);
        currentY += 29;

        doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
        const campos = [
            { l: 'N° Cotización', v: cotizacion.numero || '-' },
            { l: 'Cliente', v: cotizacion.cliente || '-' },
            { l: 'Tipo', v: cotizacion.tipo || '-' },
            { l: 'Proyecto', v: cotizacion.proyecto || '-' },
            { l: 'Objetivo', v: cotizacion.objetivo || '-' },
            { l: 'Dirección', v: cotizacion.direccion || '-' }
        ];
        for (let i = 0; i < campos.length; i++) {
            if (currentY > doc.page.height - 80) { doc.addPage(); currentY = 50; }
            if (i % 2 === 0) { doc.fillColor('#e8f0fe'); doc.rect(MARGEN_IZQ, currentY - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
            doc.text(campos[i].l + ':', MARGEN_IZQ + 5, currentY);
            doc.text(campos[i].v, MARGEN_IZQ + 150, currentY);
            currentY += 18;
        }
        doc.strokeColor('#002735').lineWidth(1);
        doc.moveTo(MARGEN_IZQ, currentY - 4).lineTo(MARGEN_DER, currentY - 4).stroke();
        currentY += 20;

        if (cotizacion.items && cotizacion.items.length > 0) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('ITEMS DE LA COTIZACIÓN', MARGEN_IZQ, currentY);
            currentY += 22;

            const colX = [MARGEN_IZQ, MARGEN_IZQ + 40, MARGEN_IZQ + 265, MARGEN_IZQ + 320, MARGEN_IZQ + 405];
            const colWidths = [40, 225, 55, 85, 110.28];

            doc.fillColor('#002735');
            doc.rect(MARGEN_IZQ, currentY, pageWidth, 24).fill();
            doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
            doc.text('N°', colX[0] + 3, currentY + 7, { align: 'center', width: colWidths[0] - 6 });
            doc.text('DESCRIPCIÓN', colX[1] + 5, currentY + 7, { align: 'center', width: colWidths[1] - 10 });
            doc.text('CANTIDAD', colX[2] + 3, currentY + 7, { align: 'center', width: colWidths[2] - 6 });
            doc.text('VALOR UNIT.', colX[3] + 3, currentY + 7, { align: 'center', width: colWidths[3] - 6 });
            doc.text('SUBTOTAL', colX[4] + 3, currentY + 7, { align: 'center', width: colWidths[4] - 6 });
            currentY += 38;

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
                if (item.tipo === 'titulo') tituloActual = item;
                else if (item.tipo === 'apu') {
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
                    var tTexto = (item.numeroMostrar || '') + ' ' + (item.descripcion || 'Título');
                    var tAncho = pageWidth - 10;
                    var tAlt = doc.heightOfString(tTexto, { width: tAncho });
                    var altFila = Math.max(18, tAlt + 6);
                    if (currentY + altFila > doc.page.height - 60) { doc.addPage(); currentY = 50; }
                    doc.fillColor('#002735').fontSize(11).font('Helvetica-Bold');
                    doc.text(tTexto, MARGEN_IZQ + 5, currentY, { width: tAncho });
                    currentY += altFila;
                    doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
                } else if (item.tipo === 'apu') {
                    const cantidad = item.cantidad || 0;
                    const vu = item.valorUnitario || 0;
                    const st = cantidad * vu;
                    subtotalGeneral += st;
                    var num = item.numeroMostrar || '';
                    var nom = item.nombre || 'APU';
                    var dAncho = colWidths[1] - 10;
                    var dAlt = doc.heightOfString(nom, { width: dAncho });
                    var altFila = Math.max(18, dAlt + 6);
                    if (currentY + altFila > doc.page.height - 60) { doc.addPage(); currentY = 50; }
                    if (i % 2 === 0) { doc.fillColor('#f0f4f8'); doc.rect(MARGEN_IZQ, currentY - 2, pageWidth, altFila).fill(); doc.fillColor('#0f172a'); }
                    doc.fontSize(9).font('Helvetica');
                    doc.text(num, colX[0] + 3, currentY, { width: colWidths[0] - 6, align: 'center' });
                    doc.text(nom, colX[1] + 5, currentY, { width: dAncho });
                    doc.text(cantidad.toString(), colX[2] + 3, currentY, { width: colWidths[2] - 6, align: 'center' });
                    doc.text(fp(vu), colX[3] + 3, currentY, { width: colWidths[3] - 6, align: 'right' });
                    doc.text(fp(st), colX[4] + 3, currentY, { width: colWidths[4] - 6, align: 'right' });
                    currentY += altFila;
                } else if (item.tipo === 'subitem') {
                    doc.fillColor('#64748b').fontSize(9).font('Helvetica');
                    var sNum = item.numeroMostrar || '';
                    var sTexto = '   ' + sNum + ' ' + (item.descripcion || 'Subitem');
                    var sAncho = pageWidth - 10;
                    var sAlt = doc.heightOfString(sTexto, { width: sAncho });
                    var altFila = Math.max(14, sAlt + 2);
                    if (currentY + altFila > doc.page.height - 60) { doc.addPage(); currentY = 50; }
                    doc.text(sTexto, MARGEN_IZQ + 5, currentY, { width: sAncho });
                    currentY += altFila;
                    doc.fillColor('#0f172a');
                }
            }

            currentY += 6;
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, currentY - 4).lineTo(MARGEN_DER, currentY - 4).stroke();

            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const stText = `Subtotal: ${fp(subtotalGeneral)}`;
            doc.text(stText, MARGEN_DER - doc.widthOfString(stText), currentY);
            currentY += 28;
        }

        const aj = cotizacion.ajustes || {};
        const aV = aj.adminValor || 0;
        const iV = aj.imprevistosValor || 0;
        const uV = aj.utilidadValor || 0;
        const ivV = aj.ivaValor || 0;
        const tFinal = aj.totalFinal || cotizacion.valorTotalFinal || 0;

        if (aV > 0 || iV > 0 || uV > 0 || ivV > 0) {
            if (currentY + 100 > doc.page.height - 60) { doc.addPage(); currentY = 50; }
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

            const lista = [
                { l: 'Administración', p: aj.adminPorc || 0, v: aV, a: aj.adminActivo !== false },
                { l: 'Imprevistos', p: aj.imprevistosPorc || 0, v: iV, a: aj.imprevistosActivo !== false },
                { l: 'Utilidad', p: aj.utilidadPorc || 0, v: uV, a: aj.utilidadActivo !== false },
                { l: 'IVA', p: aj.ivaPorc || 0, v: ivV, a: aj.ivaActivo !== false }
            ];

            let rowIdx = 0;
            for (let i = 0; i < lista.length; i++) {
                const a = lista[i];
                if (a.v > 0 && a.a) {
                    if (currentY + 18 > doc.page.height - 60) { doc.addPage(); currentY = 50; }
                    if (rowIdx % 2 === 0) { doc.fillColor('#f0f4f8'); doc.rect(MARGEN_IZQ, currentY - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
                    doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
                    doc.text(a.l + ':', aColX[0] + 5, currentY);
                    doc.text(a.p + '%', aColX[1] + 5, currentY, { align: 'center', width: 150 });
                    doc.text(fp(a.v), aColX[2] + 5, currentY, { align: 'right', width: pageWidth - 305 });
                    currentY += 18;
                    rowIdx++;
                }
            }
            currentY += 4;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, currentY - 4).lineTo(MARGEN_DER, currentY - 4).stroke();
            currentY += 18;
        }

        if (currentY + 50 > doc.page.height - 60) { doc.addPage(); currentY = 50; }
        const totalY = currentY;
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).stroke();
        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).fill();
        doc.fillColor('white').fontSize(16).font('Helvetica-Bold');
        doc.text('TOTAL COTIZACIÓN:', MARGEN_IZQ + 15, totalY + 12);
        const tv = fp(tFinal);
        doc.text(tv, MARGEN_DER - doc.widthOfString(tv) - 10, totalY + 12);

        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(range.start + i);
            const ph = doc.page.height;
            const pw = doc.page.width;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, ph - 45).lineTo(MARGEN_DER, ph - 45).stroke();
            doc.fontSize(9).font('Helvetica').fillColor('#94a3b8');
            doc.text(`Página ${i + 1} de ${totalPages}`, MARGEN_IZQ, ph - 35);
            const ct = `Creado con Eetud™ - ${new Date().getFullYear()}`;
            const cw = doc.widthOfString(ct);
            doc.text(ct, (pw - cw) / 2, ph - 35);
            const rt = 'Todos los derechos reservados.';
            doc.text(rt, MARGEN_DER - doc.widthOfString(rt), ph - 35);
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, ph - 30).lineTo(MARGEN_DER, ph - 30).stroke();
        }

        doc.end();
    } catch (error) {
        console.error('❌ Error PDF cotización:', error);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});

// ===== BORRAR USUARIOS (SOLO PRUEBAS) =====
app.post('/api/borrar-usuarios', async (req, res) => {
    try {
        await pool.query('DELETE FROM empresa_info');
        await pool.query('DELETE FROM sessions');
        await pool.query('DELETE FROM usuarios');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== RUTAS PROTEGIDAS =====
app.get('/herramientas', verificarAutenticacion, (req, res) => {
    res.render('herramientas', { title: 'Herramientas - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username });
});
app.get('/asistencia', verificarAutenticacion, (req, res) => {
    res.render('asistencia', { title: 'Asistencia - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username });
});
app.get('/materiales', verificarAutenticacion, (req, res) => {
    res.render('materiales', { title: 'Materiales - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username });
});
app.get('/apu', verificarAutenticacion, (req, res) => {
    res.render('apu', { title: 'APU - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username });
});
app.get('/cotizaciones', verificarAutenticacion, (req, res) => {
    res.render('cotizaciones', { title: 'Cotizaciones - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username });
});
app.get('/proyectos', verificarAutenticacion, (req, res) => {
    res.render('proyectos', { title: 'Proyectos - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username });
});
app.get('/cuenta', verificarAutenticacion, (req, res) => {
    res.render('cuenta', { title: 'Mi Empresa - Eetud', usuario: req.session.usuario.nombreCompleto || req.session.usuario.username, usuarioData: req.session.usuario });
});

app.get('/api/verificar-sesion', (req, res) => {
    res.json({ sessionID: req.sessionID, session: req.session, usuario: req.session?.usuario || null });
});

app.listen(PORT, async () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    await testConnection();
});