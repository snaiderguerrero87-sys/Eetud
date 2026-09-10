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

// ===== POOL DEDICADO PARA SESIONES (con SSL) =====
const sessionPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false
    }
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
    console.log('👤 Usuario:', req.session?.usuario?.username || '❌ No autenticado');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    next();
});

// ===== MIDDLEWARE AUTH =====
function verificarAutenticacion(req, res, next) {
    if (req.session && req.session.usuario) {
        next();
    } else {
        res.redirect('/login');
    }
}

function verificarAutenticacionApi(req, res, next) {
    if (req.session && req.session.usuario) {
        next();
    } else {
        res.status(401).json({ error: 'No autenticado' });
    }
}

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== RUTAS PÚBLICAS =====
app.get('/', (req, res) => {
    if (req.session && req.session.usuario) {
        return res.redirect('/dashboard');
    }
    res.render('landing', {
        title: 'Eetud - Software de Planificación de Recursos Empresariales'
    });
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
    if (req.session && req.session.usuario) {
        res.redirect('/dashboard');
    } else {
        res.render('login', { title: 'Iniciar Sesión - Eetud', error: null });
    }
});

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

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.log('Error al cerrar sesión:', err);
        res.redirect('/');
    });
});

app.get('/registro', (req, res) => {
    if (req.session && req.session.usuario) {
        res.redirect('/dashboard');
    } else {
        res.render('registro', { title: 'Registro - Eetud', error: null });
    }
});

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
            `INSERT INTO empresa_info (usuario_id, nombre, nit, telefono, email, direccion, web, descripcion, logo)
             VALUES (?, ?, ?, ?, ?, '', '', '', '')`,
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
// ===== EMPRESA INFO (MYSQL) =====
// ============================================================

app.get('/api/empresa-info', verificarAutenticacion, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT nombre, nit, telefono, email, direccion, web, descripcion, logo FROM empresa_info WHERE usuario_id = ? LIMIT 1',
            [usuarioId]
        );
        if (rows.length === 0) return res.json({});
        res.json(rows[0]);
    } catch (e) {
        console.error('❌ Error al leer empresaInfo:', e);
        res.status(500).json({ error: 'Error al leer empresaInfo' });
    }
});

app.post('/api/guardar-empresa', verificarAutenticacion, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre, nit, telefono, email, direccion, web, descripcion, logo } = req.body;

        await pool.query(
            `INSERT INTO empresa_info 
                (usuario_id, nombre, nit, telefono, email, direccion, web, descripcion, logo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                nombre = VALUES(nombre),
                nit = VALUES(nit),
                telefono = VALUES(telefono),
                email = VALUES(email),
                direccion = VALUES(direccion),
                web = VALUES(web),
                descripcion = VALUES(descripcion),
                logo = VALUES(logo)`,
            [
                usuarioId,
                nombre || '',
                nit || '',
                telefono || '',
                email || '',
                direccion || '',
                web || '',
                descripcion || '',
                logo || ''
            ]
        );

        res.json({ success: true, message: 'Información guardada correctamente' });
    } catch (error) {
        console.error('❌ Error al guardar empresa info:', error);
        res.status(500).json({ error: 'Error al guardar información' });
    }
});

app.get('/api/ping', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        session: req.session?.usuario?.username || 'no autenticado'
    });
});

// ============================================================
// ===== HERRAMIENTAS (MYSQL) =====
// ============================================================

app.get('/api/herramientas', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT id, codigo, nombre, marca, ubicacion FROM herramientas WHERE usuario_id = ? ORDER BY id DESC',
            [usuarioId]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al listar herramientas' });
    }
});

app.post('/api/herramientas', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { codigo, nombre, marca } = req.body;
        if (!codigo || !nombre || !marca) return res.status(400).json({ error: 'Campos obligatorios' });

        const [result] = await pool.query(
            'INSERT INTO herramientas (usuario_id, codigo, nombre, marca, ubicacion) VALUES (?, ?, ?, ?, ?)',
            [usuarioId, codigo, nombre, marca, '']
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear herramienta' });
    }
});

app.put('/api/herramientas/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { codigo, nombre, marca } = req.body;
        const [result] = await pool.query(
            'UPDATE herramientas SET codigo = ?, nombre = ?, marca = ? WHERE id = ? AND usuario_id = ?',
            [codigo, nombre, marca, id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

app.delete('/api/herramientas/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const [result] = await pool.query(
            'DELETE FROM herramientas WHERE id = ? AND usuario_id = ?',
            [id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

// ============================================================
// ===== EMPLEADOS (MYSQL) =====
// ============================================================

app.get('/api/empleados', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT id, nombre, cargo, costoDia, costoMes, costoHora FROM empleados WHERE usuario_id = ? ORDER BY id DESC',
            [usuarioId]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al listar empleados' });
    }
});

app.post('/api/empleados', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre, cargo, costoDia } = req.body;
        if (!nombre || !cargo || !costoDia) return res.status(400).json({ error: 'Campos obligatorios' });

        const costoDiaNum = parseFloat(costoDia);
        const costoMes = costoDiaNum * 30;
        const costoHora = costoDiaNum / 8;

        const [result] = await pool.query(
            'INSERT INTO empleados (usuario_id, nombre, cargo, costoDia, costoMes, costoHora) VALUES (?, ?, ?, ?, ?, ?)',
            [usuarioId, nombre, cargo, costoDiaNum, costoMes, costoHora]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear empleado' });
    }
});

app.put('/api/empleados/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { nombre, cargo, costoDia } = req.body;
        const costoDiaNum = parseFloat(costoDia);
        const costoMes = costoDiaNum * 30;
        const costoHora = costoDiaNum / 8;
        const [result] = await pool.query(
            'UPDATE empleados SET nombre = ?, cargo = ?, costoDia = ?, costoMes = ?, costoHora = ? WHERE id = ? AND usuario_id = ?',
            [nombre, cargo, costoDiaNum, costoMes, costoHora, id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

app.delete('/api/empleados/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const [result] = await pool.query(
            'DELETE FROM empleados WHERE id = ? AND usuario_id = ?',
            [id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

// ============================================================
// ===== MATERIALES (MYSQL) =====
// ============================================================

app.get('/api/materiales', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT id, nombre, proveedor, unidad, precio FROM materiales WHERE usuario_id = ? ORDER BY id DESC',
            [usuarioId]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al listar materiales' });
    }
});

app.post('/api/materiales', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre, proveedor, unidad, precio } = req.body;
        if (!nombre || !proveedor || !unidad || !precio) return res.status(400).json({ error: 'Campos obligatorios' });

        const [result] = await pool.query(
            'INSERT INTO materiales (usuario_id, nombre, proveedor, unidad, precio) VALUES (?, ?, ?, ?, ?)',
            [usuarioId, nombre, proveedor, unidad, parseFloat(precio)]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear material' });
    }
});

app.put('/api/materiales/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { nombre, proveedor, unidad, precio } = req.body;
        const [result] = await pool.query(
            'UPDATE materiales SET nombre = ?, proveedor = ?, unidad = ?, precio = ? WHERE id = ? AND usuario_id = ?',
            [nombre, proveedor, unidad, parseFloat(precio), id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

app.delete('/api/materiales/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const [result] = await pool.query(
            'DELETE FROM materiales WHERE id = ? AND usuario_id = ?',
            [id, usuarioId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

// ============================================================
// ===== MATERIALES - EXPORTAR FORMATO =====
// ============================================================

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
    } catch (error) {
        res.status(500).json({ error: 'Error al exportar formato' });
    }
});

app.post('/api/materiales/importar', verificarAutenticacionApi, (req, res) => {
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
            materiales.push({ nombre, proveedor, unidad, precio });
        }

        if (errores.length > 0) {
            return res.status(400).json({ error: 'Errores en el archivo', detalles: errores });
        }

        res.json({ success: true, materiales, message: `Se validaron ${materiales.length} materiales` });
    } catch (error) {
        res.status(500).json({ error: 'Error al importar: ' + error.message });
    }
});

app.post('/api/materiales/importar-lote', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { materiales } = req.body;

        if (!Array.isArray(materiales) || materiales.length === 0) {
            return res.status(400).json({ error: 'No hay materiales para importar' });
        }

        const values = materiales.map(m => [
            usuarioId,
            m.nombre || '',
            m.proveedor || '',
            m.unidad || '',
            parseFloat(m.precio) || 0
        ]);

        await pool.query(
            'INSERT INTO materiales (usuario_id, nombre, proveedor, unidad, precio) VALUES ?',
            [values]
        );

        res.json({ success: true, message: `${materiales.length} materiales importados` });
    } catch (error) {
        console.error('❌ Error al importar materiales en lote:', error);
        res.status(500).json({ error: 'Error al importar materiales' });
    }
});

// ============================================================
// ===== APUS (MYSQL - POR USUARIO) =====
// ============================================================

// Listar todos los APUs del usuario
app.get('/api/apus', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT id, codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual FROM apus WHERE usuario_id = ? ORDER BY id DESC',
            [usuarioId]
        );

        // Parsear items de JSON string a objeto
        const apus = rows.map(r => ({
            ...r,
            items: r.items ? (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) : { materiales: [], equipos: [], transporte: [], cargos: [] },
            ignorarItems: r.ignorarItems === 1 || r.ignorarItems === true
        }));

        res.json(apus);
    } catch (error) {
        console.error('❌ Error al listar APUs:', error);
        res.status(500).json({ error: 'Error al listar APUs' });
    }
});

// Obtener un APU específico
app.get('/api/apus/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const [rows] = await pool.query(
            'SELECT * FROM apus WHERE id = ? AND usuario_id = ? LIMIT 1',
            [id, usuarioId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'APU no encontrado' });

        const apu = rows[0];
        apu.items = apu.items ? (typeof apu.items === 'string' ? JSON.parse(apu.items) : apu.items) : { materiales: [], equipos: [], transporte: [], cargos: [] };
        apu.ignorarItems = apu.ignorarItems === 1 || apu.ignorarItems === true;

        res.json(apu);
    } catch (error) {
        console.error('❌ Error al obtener APU:', error);
        res.status(500).json({ error: 'Error al obtener APU' });
    }
});

// Crear APU
app.post('/api/apus', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual } = req.body;

        if (!codigo || !nombre || !categoria || !unidad) {
            return res.status(400).json({ error: 'Código, nombre, categoría y unidad son obligatorios' });
        }

        const itemsJson = JSON.stringify(items || { materiales: [], equipos: [], transporte: [], cargos: [] });

        const [result] = await pool.query(
            `INSERT INTO apus (usuario_id, codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                usuarioId,
                codigo,
                nombre,
                categoria,
                unidad,
                parseFloat(valor) || 0,
                itemsJson,
                ignorarItems ? 1 : 0,
                parseFloat(valorManual) || 0
            ]
        );

        console.log(`✅ APU creado ID ${result.insertId} para usuario ${usuarioId}`);
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('❌ Error al crear APU:', error);
        res.status(500).json({ error: 'Error al crear APU' });
    }
});

// Actualizar APU
app.put('/api/apus/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual } = req.body;

        const itemsJson = JSON.stringify(items || { materiales: [], equipos: [], transporte: [], cargos: [] });

        const [result] = await pool.query(
            `UPDATE apus SET codigo = ?, nombre = ?, categoria = ?, unidad = ?, valor = ?, items = ?, ignorarItems = ?, valorManual = ?
             WHERE id = ? AND usuario_id = ?`,
            [
                codigo,
                nombre,
                categoria,
                unidad,
                parseFloat(valor) || 0,
                itemsJson,
                ignorarItems ? 1 : 0,
                parseFloat(valorManual) || 0,
                id,
                usuarioId
            ]
        );

        if (result.affectedRows === 0) return res.status(404).json({ error: 'APU no encontrado' });

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error al actualizar APU:', error);
        res.status(500).json({ error: 'Error al actualizar APU' });
    }
});

// Eliminar APU
app.delete('/api/apus/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);

        const [result] = await pool.query(
            'DELETE FROM apus WHERE id = ? AND usuario_id = ?',
            [id, usuarioId]
        );

        if (result.affectedRows === 0) return res.status(404).json({ error: 'APU no encontrado' });

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error al eliminar APU:', error);
        res.status(500).json({ error: 'Error al eliminar APU' });
    }
});

// ============================================================
// ===== CATEGORÍAS Y UNIDADES DE APU (MYSQL - POR USUARIO) =====
// ============================================================

// Listar categorías
app.get('/api/apus/categorias', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT id, nombre FROM categorias_apu WHERE usuario_id = ? ORDER BY nombre ASC',
            [usuarioId]
        );
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al listar categorías:', error);
        res.status(500).json({ error: 'Error al listar categorías' });
    }
});

// Crear categoría
app.post('/api/apus/categorias', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre } = req.body;
        if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });

        await pool.query(
            'INSERT IGNORE INTO categorias_apu (usuario_id, nombre) VALUES (?, ?)',
            [usuarioId, nombre.trim()]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error al crear categoría:', error);
        res.status(500).json({ error: 'Error al crear categoría' });
    }
});

// Actualizar categoría
app.put('/api/apus/categorias/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);
        const { nombre } = req.body;

        await pool.query(
            'UPDATE categorias_apu SET nombre = ? WHERE id = ? AND usuario_id = ?',
            [nombre.trim(), id, usuarioId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error al actualizar categoría:', error);
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
});

// Eliminar categoría
app.delete('/api/apus/categorias/:id', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const id = parseInt(req.params.id);

        await pool.query(
            'DELETE FROM categorias_apu WHERE id = ? AND usuario_id = ?',
            [id, usuarioId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error al eliminar categoría:', error);
        res.status(500).json({ error: 'Error al eliminar categoría' });
    }
});

// Listar unidades
app.get('/api/apus/unidades', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const [rows] = await pool.query(
            'SELECT id, nombre FROM unidades_apu WHERE usuario_id = ? ORDER BY nombre ASC',
            [usuarioId]
        );
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al listar unidades:', error);
        res.status(500).json({ error: 'Error al listar unidades' });
    }
});

// Crear unidad
app.post('/api/apus/unidades', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const { nombre } = req.body;
        if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });

        await pool.query(
            'INSERT IGNORE INTO unidades_apu (usuario_id, nombre) VALUES (?, ?)',
            [usuarioId, nombre.trim().toUpperCase()]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error al crear unidad:', error);
        res.status(500).json({ error: 'Error al crear unidad' });
    }
});

// ============================================================
// ===== EXPORTAR FORMATO APU =====
// ============================================================

app.get('/api/apus/exportar-formato', verificarAutenticacionApi, async (req, res) => {
    try {
        const usuarioId = req.session.usuario.id;
        const ExcelJS = require('exceljs');

        // Cargar unidades del usuario desde MySQL
        const [unidadesRows] = await pool.query(
            'SELECT nombre FROM unidades_apu WHERE usuario_id = ? ORDER BY nombre ASC',
            [usuarioId]
        );
        let unidadesGuardadas = unidadesRows.map(r => r.nombre);

        // Si no hay unidades, usar defaults
        if (unidadesGuardadas.length === 0) {
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
        res.status(500).json({ error: 'Error al exportar formato: ' + error.message });
    }
});

// ============================================================
// ===== IMPORTAR APUS =====
// ============================================================

app.post('/api/apus/importar', verificarAutenticacionApi, async (req, res) => {
    try {
        const XLSX = require('xlsx');
        const usuarioId = req.session.usuario.id;
        const { file } = req.body;
        if (!file) return res.status(400).json({ error: 'No se recibió el archivo' });

        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let worksheet = workbook.Sheets['APU'];

        if (!worksheet) {
            for (let i = 0; i < workbook.SheetNames.length; i++) {
                const testSheet = workbook.Sheets[workbook.SheetNames[i]];
                const testData = XLSX.utils.sheet_to_json(testSheet, { defval: '' });
                if (testData.length > 0) {
                    worksheet = testSheet;
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
            return res.status(400).json({ error: `Faltan columnas: ${missingHeaders.join(', ')}`, required: requiredHeaders });
        }

        // Cargar categorías y unidades del usuario
        const [categoriasRows] = await pool.query(
            'SELECT nombre FROM categorias_apu WHERE usuario_id = ?',
            [usuarioId]
        );
        let categoriasExistentes = categoriasRows.map(r => r.nombre);

        function obtenerString(valor) {
            return valor === undefined || valor === null ? '' : String(valor).trim();
        }

        function obtenerNumero(valor) {
            if (!valor) return 0;
            if (typeof valor === 'number') return valor;
            let limpio = String(valor).replace(/[€£¥$.,\s]/g, '');
            return parseFloat(limpio) || 0;
        }

        // Agrupar por código
        const apusMap = {};
        let errores = [];
        let categoriasNuevas = [];

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

            // Detectar categorías nuevas
            if (!categoriasExistentes.some(c => c.toLowerCase() === categoria.toLowerCase())) {
                if (!categoriasNuevas.includes(categoria)) categoriasNuevas.push(categoria);
            }

            if (!apusMap[codigo]) {
                apusMap[codigo] = {
                    codigo: codigo,
                    nombre: nombre,
                    categoria: categoria,
                    unidad: unidad,
                    items: { materiales: [], equipos: [], transporte: [], cargos: [] }
                };
            }

            // Equipo
            const nombreEquipo = obtenerString(row['Nombre del Equipo/Herramienta']);
            if (nombreEquipo) {
                const porcentaje = obtenerNumero(row['Porcentaje (%)']);
                const valorBase = obtenerNumero(row['Valor Base Equipo']);
                apusMap[codigo].items.equipos.push({
                    nombre: nombreEquipo,
                    unidad: '%',
                    porcentaje: porcentaje,
                    valorBase: valorBase,
                    subtotal: (porcentaje / 100) * valorBase
                });
            }

            // Transporte
            const nombreTransporte = obtenerString(row['Nombre del Transporte']);
            if (nombreTransporte) {
                const porcentajeT = obtenerNumero(row['Porcentaje Transporte (%)']);
                const valorBaseT = obtenerNumero(row['Valor Base Transporte']);
                apusMap[codigo].items.transporte.push({
                    nombre: nombreTransporte,
                    unidad: '%',
                    porcentaje: porcentajeT,
                    valorBase: valorBaseT,
                    subtotal: (porcentajeT / 100) * valorBaseT
                });
            }

            // Mano de obra
            const descripcionMano = obtenerString(row['Descripción Mano de Obra']);
            if (descripcionMano) {
                const unidadMano = obtenerString(row['Unidad Mano de Obra']) || 'und';
                const cantidadMano = obtenerNumero(row['Cantidad Mano de Obra']);
                const valorUnitarioMano = obtenerNumero(row['Valor Unitario Mano de Obra']);
                apusMap[codigo].items.cargos.push({
                    descripcion: descripcionMano,
                    unidad: unidadMano,
                    cantidad: cantidadMano,
                    valorUnitario: valorUnitarioMano,
                    subtotal: cantidadMano * valorUnitarioMano
                });
            }
        }

        if (errores.length > 0) {
            return res.status(400).json({ success: false, error: 'Errores en el archivo', detalles: errores });
        }

        // Guardar en MySQL
        let apusImportados = 0;
        for (const codigo in apusMap) {
            const apu = apusMap[codigo];

            // Calcular valor total
            let valorTotal = 0;
            apu.items.equipos.forEach(e => { valorTotal += e.subtotal; });
            apu.items.transporte.forEach(t => { valorTotal += t.subtotal; });
            apu.items.cargos.forEach(c => { valorTotal += c.subtotal; });

            await pool.query(
                `INSERT INTO apus (usuario_id, codigo, nombre, categoria, unidad, valor, items, ignorarItems, valorManual)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
                [
                    usuarioId,
                    apu.codigo,
                    apu.nombre,
                    apu.categoria,
                    apu.unidad,
                    valorTotal,
                    JSON.stringify(apu.items)
                ]
            );
            apusImportados++;
        }

        // Guardar categorías nuevas
        for (const cat of categoriasNuevas) {
            await pool.query(
                'INSERT IGNORE INTO categorias_apu (usuario_id, nombre) VALUES (?, ?)',
                [usuarioId, cat]
            );
        }

        // Guardar unidades nuevas
        const unidadesSet = new Set();
        for (const codigo in apusMap) {
            unidadesSet.add(apusMap[codigo].unidad);
        }
        for (const uni of unidadesSet) {
            await pool.query(
                'INSERT IGNORE INTO unidades_apu (usuario_id, nombre) VALUES (?, ?)',
                [usuarioId, uni]
            );
        }

        res.json({
            success: true,
            message: `✅ ${apusImportados} APUs importados`,
            apusImportados: apusImportados,
            categoriasNuevas: categoriasNuevas
        });

    } catch (error) {
        console.error('❌ Error al importar APUs:', error);
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
        const usuarioId = req.session.usuario.id;

        const [apuRows] = await pool.query(
            'SELECT * FROM apus WHERE id = ? AND usuario_id = ? LIMIT 1',
            [apuId, usuarioId]
        );
        if (apuRows.length === 0) return res.status(404).json({ error: 'APU no encontrado' });

        const apuData = apuRows[0];
        apuData.items = apuData.items ? (typeof apuData.items === 'string' ? JSON.parse(apuData.items) : apuData.items) : { materiales: [], equipos: [], transporte: [], cargos: [] };

        let empresaData = {};
        const [empresas] = await pool.query(
            'SELECT nombre, nit, telefono, email, direccion, web, descripcion, logo FROM empresa_info WHERE usuario_id = ? LIMIT 1',
            [usuarioId]
        );
        if (empresas.length > 0) empresaData = empresas[0];

        const doc = new PDFDocument({
            size: 'A4', margin: 40,
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

        function formatearPrecio(v) { return '$' + Number(v).toLocaleString('es-CO'); }
        function formatearFecha() {
            const a = new Date();
            return a.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        const pageWidth = doc.page.width - 80;
        let currentY = 40;

        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(40, currentY, pageWidth, 90).stroke();

        let logoX = 55, logoY = currentY + 10, logoCargado = false;
        if (empresaData.logo && empresaData.logo.startsWith('data:image')) {
            try {
                const base64Data = empresaData.logo.replace(/^data:image\/\w+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const tempLogoPath = path.join(__dirname, 'data', 'temp_logo.png');
                fs.writeFileSync(tempLogoPath, imageBuffer);
                doc.image(tempLogoPath, logoX, logoY, { width: 65, height: 65 });
                logoCargado = true; logoX = 135;
                fs.unlinkSync(tempLogoPath);
            } catch (e) {}
        }
        if (!logoCargado) {
            try {
                const defaultLogoPath = path.join(__dirname, 'public', 'assets', 'logo.jpg');
                if (fs.existsSync(defaultLogoPath)) {
                    doc.image(defaultLogoPath, logoX, logoY, { width: 65, height: 65 });
                    logoCargado = true; logoX = 135;
                }
            } catch (e) {}
        }
        if (!logoCargado) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('LOGO', logoX + 10, logoY + 20, { width: 65, align: 'center' });
            logoX = 135;
        }

        const empresaNombre = empresaData.nombre || 'MI EMPRESA';
        let textX = logoX + 10, textY = currentY + 12;
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
        doc.fillColor('white').fontSize(12).font('Helvetica-Bold');
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
            if (currentY > doc.page.height - 100) { doc.addPage(); currentY = 50; }
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
            doc.text('EQUIPOS Y HERRAMIENTAS', 50, y); y += 18;
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
            let sub = 0;
            for (let i = 0; i < equipos.length; i++) {
                const e = equipos[i];
                sub += e.subtotal || 0;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) { doc.fillColor('#f8fafc'); doc.rect(50, y - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
                doc.text((e.nombre || '').substring(0, 20), colX[0] + 5, y);
                doc.text(e.unidad || '%', colX[1] + 5, y);
                doc.text((e.porcentaje || 0) + '%', colX[2] + 5, y);
                doc.text(formatearPrecio(e.valorBase || 0), colX[3] + 5, y);
                doc.text(formatearPrecio(e.subtotal || 0), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const text = `Subtotal Equipos y Herramientas: ${formatearPrecio(sub)}`;
            doc.text(text, doc.page.width - 50 - doc.widthOfString(text), y);
            currentY = y + 20;
        }

        // Transporte
        const transportes = apuData.items?.transporte || [];
        if (transportes.length > 0) {
            const colX = [50, 180, 280, 380, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('TRANSPORTE DE MATERIALES', 50, y); y += 18;
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
            let sub = 0;
            for (let i = 0; i < transportes.length; i++) {
                const t = transportes[i];
                sub += t.subtotal || 0;
                if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
                if (i % 2 === 0) { doc.fillColor('#f8fafc'); doc.rect(50, y - 2, pageWidth, 18).fill(); doc.fillColor('#0f172a'); }
                doc.text((t.nombre || '').substring(0, 20), colX[0] + 5, y);
                doc.text(t.unidad || '%', colX[1] + 5, y);
                doc.text((t.porcentaje || 0) + '%', colX[2] + 5, y);
                doc.text(formatearPrecio(t.valorBase || 0), colX[3] + 5, y);
                doc.text(formatearPrecio(t.subtotal || 0), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const text = `Subtotal Transporte: ${formatearPrecio(sub)}`;
            doc.text(text, doc.page.width - 50 - doc.widthOfString(text), y);
            currentY = y + 20;
        }

        // Mano de Obra
        const cargos = apuData.items?.cargos || [];
        if (cargos.length > 0) {
            const colX = [50, 200, 320, 420, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('MANO DE OBRA', 50, y); y += 18;
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
                doc.text(formatearPrecio(c.valorUnitario || 0), colX[3] + 5, y);
                doc.text(formatearPrecio(s), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const text = `Subtotal Mano de Obra: ${formatearPrecio(sub)}`;
            doc.text(text, doc.page.width - 50 - doc.widthOfString(text), y);
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
        doc.text(totalValue, doc.page.width - 50 - doc.widthOfString(totalValue) - 10, totalY + 10);

        doc.end();
    } catch (error) {
        console.error('❌ Error al generar PDF APU:', error);
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
            size: 'A4', margin: 40,
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

        function formatearPrecio(v) { return '$' + Number(v).toLocaleString('es-CO'); }
        function formatearFecha() {
            const a = new Date();
            return a.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        const MARGEN_IZQ = 40;
        const MARGEN_DER = doc.page.width - 40;
        const pageWidth = MARGEN_DER - MARGEN_IZQ;
        let currentY = 40;

        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, currentY, pageWidth, 90).stroke();

        let logoX = MARGEN_IZQ + 15, logoY = currentY + 10, logoCargado = false;
        if (empresa.logo && empresa.logo.startsWith('data:image')) {
            try {
                const base64Data = empresa.logo.replace(/^data:image\/\w+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const tempLogoPath = path.join(__dirname, 'data', 'temp_logo_cotizacion.png');
                fs.writeFileSync(tempLogoPath, imageBuffer);
                doc.image(tempLogoPath, logoX, logoY, { width: 65, height: 65 });
                logoCargado = true; logoX = MARGEN_IZQ + 95;
                fs.unlinkSync(tempLogoPath);
            } catch (e) {}
        }
        if (!logoCargado) {
            try {
                const defaultLogoPath = path.join(__dirname, 'public', 'assets', 'logo.jpg');
                if (fs.existsSync(defaultLogoPath)) {
                    doc.image(defaultLogoPath, logoX, logoY, { width: 65, height: 65 });
                    logoCargado = true; logoX = MARGEN_IZQ + 95;
                }
            } catch (e) {}
        }
        if (!logoCargado) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('LOGO', logoX + 10, logoY + 20, { width: 65, align: 'center' });
            logoX = MARGEN_IZQ + 95;
        }

        let textX = logoX + 10, textY = currentY + 12;
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
            if (currentY > doc.page.height - 80) { doc.addPage(); currentY = 50; }
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
            currentY += 24 + 14;

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
                    var tituloTexto = (item.numeroMostrar || '') + ' ' + (item.descripcion || 'Título');
                    var tituloAncho = pageWidth - 10;
                    var tituloAltura = doc.heightOfString(tituloTexto, { width: tituloAncho });
                    var alturaFila = Math.max(18, tituloAltura + 6);
                    if (currentY + alturaFila > doc.page.height - 60) { doc.addPage(); currentY = 50; }
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
                    if (currentY + alturaFila > doc.page.height - 60) { doc.addPage(); currentY = 50; }
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
                    var subTexto = '   ' + subNumero + ' ' + (item.descripcion || 'Subitem');
                    var subAncho = pageWidth - 10;
                    var subAltura = doc.heightOfString(subTexto, { width: subAncho });
                    var alturaFila = Math.max(14, subAltura + 2);
                    if (currentY + alturaFila > doc.page.height - 60) { doc.addPage(); currentY = 50; }
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
            doc.text(subtotalText, MARGEN_DER - doc.widthOfString(subtotalText), currentY);
            currentY += 28;
        }

        const ajustes = cotizacion.ajustes || {};
        const adminValor = ajustes.adminValor || 0;
        const imprevistosValor = ajustes.imprevistosValor || 0;
        const utilidadValor = ajustes.utilidadValor || 0;
        const ivaValor = ajustes.ivaValor || 0;
        const totalFinal = ajustes.totalFinal || cotizacion.valorTotalFinal || 0;

        if (adminValor > 0 || imprevistosValor > 0 || utilidadValor > 0 || ivaValor > 0) {
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
                    if (currentY + 18 > doc.page.height - 60) { doc.addPage(); currentY = 50; }
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

        if (currentY + 50 > doc.page.height - 60) { doc.addPage(); currentY = 50; }
        const totalY = currentY;
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).stroke();
        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).fill();
        doc.fillColor('white').fontSize(16).font('Helvetica-Bold');
        doc.text('TOTAL COTIZACIÓN:', MARGEN_IZQ + 15, totalY + 12);
        const totalValue = formatearPrecio(totalFinal);
        doc.text(totalValue, MARGEN_DER - doc.widthOfString(totalValue) - 10, totalY + 12);
        currentY = totalY + 45;

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
            doc.text(rightsText, MARGEN_DER - doc.widthOfString(rightsText), pageHeight - 35);
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, pageHeight - 30).lineTo(MARGEN_DER, pageHeight - 30).stroke();
        }

        doc.end();
    } catch (error) {
        res.status(500).json({ error: 'Error al generar el PDF: ' + error.message });
    }
});

// ===== BORRAR USUARIOS (SOLO PRUEBAS) =====
app.post('/api/borrar-usuarios', async (req, res) => {
    try {
        await pool.query('DELETE FROM empresa_info');
        await pool.query('DELETE FROM sessions');
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
        title: 'Listado de APU - Eetud',
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

app.get('/api/verificar-sesion', (req, res) => {
    res.json({
        sessionID: req.sessionID,
        session: req.session,
        usuario: req.session?.usuario || null
    });
});

app.listen(PORT, async () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    await testConnection();
});