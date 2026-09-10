const express = require('express');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIGURACIONES CON LÍMITE AUMENTADO =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== CONFIGURACIÓN DE SESIÓN CON FILE-STORE =====
app.use(session({
    store: new FileStore({
        path: path.join(__dirname, 'data', 'sessions'),
        ttl: 86400,
        reapInterval: 3600
    }),
    secret: 'eetud_secret_key_2026_muy_segura',
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
    console.log('🔍 Verificando autenticación...');
    
    if (req.session && req.session.usuario) {
        console.log('✅ Usuario autenticado:', req.session.usuario.username);
        next();
    } else {
        console.log('❌ No autenticado, redirigiendo a login');
        res.redirect('/login');
    }
}

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== FUNCIONES PARA MANEJAR USUARIOS =====
function obtenerUsuarios() {
    try {
        const usuariosPath = path.join(__dirname, 'data', 'usuarios.json');
        if (fs.existsSync(usuariosPath)) {
            const data = fs.readFileSync(usuariosPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Error al leer usuarios:', e);
    }
    return [];
}

function guardarUsuarios(usuarios) {
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        fs.writeFileSync(path.join(dataPath, 'usuarios.json'), JSON.stringify(usuarios, null, 2));
    } catch (e) {
        console.log('Error al guardar usuarios:', e);
    }
}

function guardarEmpresaInfo(usuario) {
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        
        const empresaInfo = {
            nombre: usuario.nombreCompleto || usuario.username,
            nit: usuario.nit || '',
            telefono: usuario.telefono || '',
            email: usuario.email || '',
            direccion: '',
            web: '',
            descripcion: '',
            logo: ''
        };
        
        fs.writeFileSync(path.join(dataPath, 'empresaInfo.json'), JSON.stringify(empresaInfo, null, 2));
    } catch (e) {
        console.log('Error al guardar empresaInfo:', e);
    }
}

// ===== FUNCIONES PARA LEER DATOS GUARDADOS =====
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

// ===== RUTAS DE AUTENTICACIÓN =====

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

// Login - POST
app.post('/login', (req, res) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 === INICIO DE LOGIN ===');
    console.log('📝 Body recibido:', req.body);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
        console.log('❌ Campos vacíos');
        return res.render('login', { 
            title: 'Iniciar Sesión - Eetud',
            error: 'Por favor, ingresa todos los campos'
        });
    }

    console.log('🔍 Buscando usuario:', username);
    const usuarios = obtenerUsuarios();
    console.log('📋 Usuarios registrados:', usuarios.map(u => u.username));
    
    const usuario = usuarios.find(u => 
        (u.username === username || u.email === username) && u.password === password
    );

    if (!usuario) {
        console.log('❌ Usuario no encontrado o contraseña incorrecta');
        return res.render('login', { 
            title: 'Iniciar Sesión - Eetud',
            error: 'Usuario o contraseña incorrectos'
        });
    }

    console.log('✅ Usuario encontrado:', usuario.username);

    req.session.usuario = {
        id: usuario.id,
        username: usuario.username,
        email: usuario.email,
        telefono: usuario.telefono,
        nit: usuario.nit,
        nombreCompleto: usuario.nombreCompleto || usuario.username
    };

    console.log('📦 req.session.usuario asignado:', req.session.usuario);

    req.session.save((err) => {
        if (err) {
            console.log('❌ Error al guardar sesión:', err);
            return res.render('login', { 
                title: 'Iniciar Sesión - Eetud',
                error: 'Error al iniciar sesión. Intenta nuevamente.'
            });
        }
        
        console.log('✅ Sesión guardada correctamente');
        console.log('📦 req.session.usuario después de guardar:', req.session.usuario);
        
        guardarEmpresaInfo(usuario);
        res.redirect('/dashboard');
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log('Error al cerrar sesión:', err);
        }
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

// Registro - POST
app.post('/registro', (req, res) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 === INICIO DE REGISTRO ===');
    console.log('📝 Body recibido:', req.body);
    
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

    const usuarios = obtenerUsuarios();
    if (usuarios.find(u => u.username === username)) {
        return res.render('registro', { 
            title: 'Registro - Eetud',
            error: 'El nombre de usuario ya está registrado'
        });
    }
    if (usuarios.find(u => u.email === email)) {
        return res.render('registro', { 
            title: 'Registro - Eetud',
            error: 'El correo electrónico ya está registrado'
        });
    }
    if (usuarios.find(u => u.nit === nit)) {
        return res.render('registro', { 
            title: 'Registro - Eetud',
            error: 'El NIT ya está registrado'
        });
    }

    const nuevoUsuario = {
        id: usuarios.length > 0 ? Math.max(...usuarios.map(u => u.id)) + 1 : 1,
        username: username,
        nombreCompleto: nombreCompleto || username,
        email: email,
        telefono: telefono,
        nit: nit,
        password: password,
        fechaRegistro: new Date().toISOString()
    };

    usuarios.push(nuevoUsuario);
    guardarUsuarios(usuarios);
    guardarEmpresaInfo(nuevoUsuario);

    req.session.usuario = {
        id: nuevoUsuario.id,
        username: nuevoUsuario.username,
        email: nuevoUsuario.email,
        telefono: nuevoUsuario.telefono,
        nit: nuevoUsuario.nit,
        nombreCompleto: nuevoUsuario.nombreCompleto
    };

    req.session.save((err) => {
        if (err) {
            console.log('❌ Error al guardar sesión en registro:', err);
        }
        res.redirect('/dashboard');
    });
});

// ============================================================
// ===== RUTAS PARA EMPRESA INFO (CON LOGO) =====
// ============================================================

// Obtener empresa info
app.get('/api/empresa-info', (req, res) => {
    console.log('📂 === OBTENIENDO EMPRESA INFO ===');
    try {
        const empresaPath = path.join(__dirname, 'data', 'empresaInfo.json');
        if (fs.existsSync(empresaPath)) {
            const data = fs.readFileSync(empresaPath, 'utf8');
            console.log('✅ Empresa info enviada');
            res.json(JSON.parse(data));
        } else {
            console.log('⚠️ Archivo empresaInfo.json no existe');
            res.json({});
        }
    } catch (e) {
        console.error('❌ Error al leer empresaInfo:', e);
        res.status(500).json({ error: 'Error al leer empresaInfo' });
    }
});

// Guardar empresa info (con logo) - SIN AUTENTICACIÓN
app.post('/api/guardar-empresa', (req, res) => {
    console.log('💾 === GUARDANDO EMPRESA INFO ===');
    console.log('📦 Datos recibidos:', req.body);
    console.log('🖼️ Logo presente:', req.body.logo ? 'SÍ' : 'NO');
    console.log('📊 Longitud del logo:', req.body.logo ? req.body.logo.length : 0);
    
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        
        const empresaPath = path.join(dataPath, 'empresaInfo.json');
        fs.writeFileSync(empresaPath, JSON.stringify(req.body, null, 2));
        
        console.log('✅ Empresa info guardada en el servidor');
        res.json({ success: true, message: 'Información guardada correctamente' });
    } catch (error) {
        console.error('❌ Error al guardar empresa info:', error);
        res.status(500).json({ error: 'Error al guardar información' });
    }
});

// ===== RUTA DE PRUEBA PARA VERIFICAR ESTADO DEL SERVIDOR =====
app.get('/api/ping', (req, res) => {
    console.log('🏓 PING recibido');
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        session: req.session?.usuario?.username || 'no autenticado'
    });
});

// ============================================================
// ===== RUTAS PARA APUS (SINCRONIZACIÓN CLIENTE-SERVIDOR) =====
// ============================================================

// Ruta para obtener APUs del servidor
app.get('/api/apus', verificarAutenticacion, (req, res) => {
    console.log('📂 === SOLICITANDO APUS DEL SERVIDOR ===');
    
    try {
        const apuPath = path.join(__dirname, 'data', 'apu.json');
        if (fs.existsSync(apuPath)) {
            const data = fs.readFileSync(apuPath, 'utf8');
            const apus = JSON.parse(data);
            console.log('📦 APUs enviados al cliente:', apus.length);
            res.json(apus);
        } else {
            console.log('⚠️ Archivo apu.json no existe');
            res.json([]);
        }
    } catch (error) {
        console.error('❌ Error al leer APUs:', error);
        res.status(500).json({ error: 'Error al leer APUs' });
    }
});

// Ruta para guardar APUs en el servidor
app.post('/api/guardar-apus', verificarAutenticacion, (req, res) => {
    console.log('💾 === RECIBIENDO APUS PARA GUARDAR ===');
    console.log('📦 Cantidad de APUs:', req.body.length);
    
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        
        const apuPath = path.join(dataPath, 'apu.json');
        fs.writeFileSync(apuPath, JSON.stringify(req.body, null, 2));
        
        console.log('✅ APUs guardados en el servidor:', req.body.length);
        res.json({ success: true, message: 'APUs guardados en el servidor' });
    } catch (error) {
        console.error('❌ Error al guardar APUs:', error);
        res.status(500).json({ error: 'Error al guardar APUs' });
    }
});

// ============================================================
// ===== RUTA PARA EXPORTAR APU (SIN MATERIALES) =====
// ============================================================

// Ruta para descargar el formato de APU (SIN MATERIALES)
app.get('/api/apus/exportar-formato', verificarAutenticacion, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');

        // ===== CARGAR DATOS =====
        let unidadesGuardadas = [];

        try {
            const unidadesPath = path.join(__dirname, 'data', 'unidades.json');
            if (fs.existsSync(unidadesPath)) {
                const data = fs.readFileSync(unidadesPath, 'utf8');
                unidadesGuardadas = JSON.parse(data);
                console.log('📋 Unidades cargadas:', unidadesGuardadas.length);
            }
        } catch (e) {
            unidadesGuardadas = ['und', 'm', 'm2', 'm3', 'kg', 'ml', 'hr', 'dia'];
        }

        // ===== CREAR LIBRO =====
        const workbook = new ExcelJS.Workbook();

        // ===== HOJA: LISTAS (oculta) =====
        const listasSheet = workbook.addWorksheet('Listas');
        listasSheet.state = 'hidden';

        // Escribir unidades en columna B (desde fila 2)
        listasSheet.getCell('B1').value = 'UNIDADES';
        listasSheet.getCell('B1').font = { bold: true };
        unidadesGuardadas.forEach((u, index) => {
            listasSheet.getCell(`B${index + 2}`).value = u;
        });

        // Ajustar ancho de columnas en Listas
        listasSheet.getColumn(2).width = 20;

        // ===== HOJA: APU =====
        const worksheet = workbook.addWorksheet('APU');

        // Columnas (SIN MATERIALES)
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

        // Estilo del encabezado
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF002735' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 25;

        // Datos de ejemplo
        const data = [
            ['A001', 'Excavación Manual', 'Movimiento de Tierra', 'm3', 'Excavadora', '%', '15', '50000', 'Flete', '%', '10', '30000', 'Oficial', 'und', '2', '80000'],
            ['A001', 'Excavación Manual', 'Movimiento de Tierra', 'm3', '', '%', '', '', '', '%', '', '', 'Ayudante', 'und', '4', '50000'],
            ['B001', 'Cimentación', 'Estructura', 'm3', 'Mezcladora', '%', '10', '60000', '', '%', '', '', 'Ingeniero', 'und', '1', '120000'],
            ['B001', 'Cimentación', 'Estructura', 'm3', '', '%', '', '', '', '%', '', '', 'Oficial', 'und', '3', '80000']
        ];

        data.forEach(row => {
            worksheet.addRow(row);
        });

        // ===== LISTA DESPLEGABLE CON REFERENCIA A CELDAS =====
        for (let rowNum = 2; rowNum <= data.length + 1; rowNum++) {
            worksheet.getCell(`D${rowNum}`).dataValidation = {
                type: 'list',
                formulae: ['=Listas!B:B'],
                showErrorMessage: true,
                errorTitle: 'Valor inválido',
                error: 'Selecciona una unidad de la lista'
            };
        }
        console.log('✅ Lista desplegable con ' + unidadesGuardadas.length + ' unidades (referencia a celdas)');

        // ===== HOJA: INSTRUCCIONES =====
        const instruccionesSheet = workbook.addWorksheet('Instrucciones');
        instruccionesSheet.getColumn(1).width = 80;

        const instrucciones = [
            '📋 INSTRUCCIONES PARA IMPORTAR APU',
            '',
            '📋 UNIDADES DISPONIBLES: ' + unidadesGuardadas.length + ' unidades',
            '   - Todas las unidades están en la lista desplegable de la columna "Unidad"',
            '',
            '1. Un mismo APU puede tener múltiples filas (mismo Código)',
            '   - Ejemplo: A001 puede tener 3 filas (2 equipos + 1 mano de obra)',
            '',
            '2. Columnas obligatorias:',
            '   - Código, Nombre, Categoría, Unidad',
            '',
            '3. Para agregar EQUIPOS:',
            '   - Completar: Nombre, Unidad Equipo (%), Porcentaje (%), Valor Base',
            '   - La Unidad Equipo (%) siempre debe ser "%"',
            '   - El subtotal = (Porcentaje / 100) * Valor Base',
            '',
            '4. Para agregar TRANSPORTE:',
            '   - Completar: Nombre, Unidad Transporte (%), Porcentaje (%), Valor Base',
            '   - La Unidad Transporte (%) siempre debe ser "%"',
            '   - El subtotal = (Porcentaje / 100) * Valor Base',
            '',
            '5. Para agregar MANO DE OBRA:',
            '   - Completar: Descripción, Unidad, Cantidad, Valor Unitario',
            '   - El subtotal = Cantidad * Valor Unitario',
            '',
            '6. Las categorías nuevas se crearán automáticamente al importar',
            '',
            '7. El APU puede guardarse sin equipos, transporte o mano de obra,',
            '   pero al menos debe tener un item (equipo, transporte o mano de obra)',
            '   o activar la opción "Ignorar items" en el sistema'
        ];

        instrucciones.forEach(line => {
            instruccionesSheet.addRow([line]);
        });

        // ===== GENERAR ARCHIVO =====
        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=formato_apu.xlsx');
        res.send(buffer);

        console.log('✅ Formato APU exportado (SIN MATERIALES)');
        console.log('📊 Hojas: APU, Listas (oculta), Instrucciones');

    } catch (error) {
        console.error('❌ Error al exportar formato APU:', error);
        console.error('📋 Stack:', error.stack);
        res.status(500).json({ error: 'Error al exportar formato: ' + error.message });
    }
});

// ============================================================
// ===== RUTA PARA IMPORTAR APUS =====
// ============================================================

// Ruta para importar APUs desde Excel
app.post('/api/apus/importar', verificarAutenticacion, (req, res) => {
    console.log('📂 === VALIDANDO IMPORTACIÓN DE APUs ===');
    
    try {
        const XLSX = require('xlsx');
        const { file } = req.body;
        
        if (!file) {
            return res.status(400).json({ error: 'No se recibió el archivo' });
        }
        
        // Decodificar base64
        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        
        // ===== BUSCAR LA HOJA "APU" =====
        let sheetName = 'APU';
        let worksheet = workbook.Sheets[sheetName];
        
        if (!worksheet) {
            console.log('⚠️ Hoja "APU" no encontrada, buscando hoja con datos...');
            const sheetNames = workbook.SheetNames;
            for (let i = 0; i < sheetNames.length; i++) {
                const testSheet = workbook.Sheets[sheetNames[i]];
                const testData = XLSX.utils.sheet_to_json(testSheet, { defval: '' });
                if (testData.length > 0) {
                    worksheet = testSheet;
                    sheetName = sheetNames[i];
                    console.log('✅ Usando hoja:', sheetName);
                    break;
                }
            }
        }
        
        if (!worksheet) {
            return res.status(400).json({ error: 'No se encontró la hoja "APU" o está vacía' });
        }
        
        // ===== LEER DATOS Y LIMPIAR NOMBRES DE COLUMNAS =====
        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        // Limpiar nombres de columnas (quitar espacios al inicio y final)
        const data = rawData.map(row => {
            const newRow = {};
            Object.keys(row).forEach(key => {
                const cleanKey = key.trim();
                newRow[cleanKey] = row[key];
            });
            return newRow;
        });
        
        console.log('📊 Datos importados desde hoja "' + sheetName + '":', data.length);
        
        if (data.length === 0) {
            return res.status(400).json({ error: 'El archivo está vacío. Asegúrate de llenar la hoja "APU"' });
        }
        
        const headers = Object.keys(data[0]);
        console.log('📋 Encabezados encontrados (limpios):', headers);
        
        // Validar columnas requeridas
        const requiredHeaders = ['Código', 'Nombre', 'Categoría', 'Unidad'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        
        if (missingHeaders.length > 0) {
            return res.status(400).json({ 
                error: `Faltan columnas: ${missingHeaders.join(', ')}`,
                required: requiredHeaders,
                headersEncontrados: headers
            });
        }
        
        // ===== VALIDAR DATOS =====
        let errores = [];
        let codigos = {};
        let categoriasNuevas = [];
        
        let categoriasExistentes = leerCategoriasGuardadas();
        
        // ===== FUNCIÓN PARA EXTRAER VALOR NUMÉRICO =====
        function obtenerNumero(valor) {
            if (valor === undefined || valor === null || valor === '') return 0;
            if (typeof valor === 'number') return valor;
            if (typeof valor === 'string') {
                let limpio = valor
                    .replace(/[€£¥]/g, '')
                    .replace(/\$/g, '')
                    .replace(/\./g, '')
                    .replace(/,/g, '.')
                    .replace(/\s/g, '')
                    .trim();
                if (limpio === '') return 0;
                const num = parseFloat(limpio);
                return isNaN(num) ? 0 : num;
            }
            return 0;
        }
        
        function obtenerString(valor) {
            if (valor === undefined || valor === null) return '';
            return String(valor).trim();
        }
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const filaNum = i + 2;
            
            const codigo = obtenerString(row['Código']);
            const nombre = obtenerString(row['Nombre']);
            const categoria = obtenerString(row['Categoría']);
            const unidad = obtenerString(row['Unidad']).toUpperCase();
            const nombreEquipo = obtenerString(row['Nombre del Equipo/Herramienta']);
            const unidadEquipo = obtenerString(row['Unidad Equipo (%)']);
            const porcentaje = obtenerNumero(row['Porcentaje (%)']);
            const valorBaseEquipo = obtenerNumero(row['Valor Base Equipo']);
            const nombreTransporte = obtenerString(row['Nombre del Transporte']);
            const unidadTransporte = obtenerString(row['Unidad Transporte (%)']);
            const porcentajeTransporte = obtenerNumero(row['Porcentaje Transporte (%)']);
            const valorBaseTransporte = obtenerNumero(row['Valor Base Transporte']);
            const descripcionMano = obtenerString(row['Descripción Mano de Obra']);
            const unidadMano = obtenerString(row['Unidad Mano de Obra']) || 'und';
            const cantidadMano = obtenerNumero(row['Cantidad Mano de Obra']);
            const valorUnitarioMano = obtenerNumero(row['Valor Unitario Mano de Obra']);
            
            // === VALIDAR CAMPOS OBLIGATORIOS ===
            if (!codigo) {
                errores.push(`Fila ${filaNum}: Código vacío`);
                continue;
            }
            if (!nombre) {
                errores.push(`Fila ${filaNum}: Nombre vacío`);
                continue;
            }
            if (!categoria) {
                errores.push(`Fila ${filaNum}: Categoría vacía`);
                continue;
            }
            if (!unidad) {
                errores.push(`Fila ${filaNum}: Unidad vacía`);
                continue;
            }
            
            // === VALIDAR ITEMS ===
            const tieneEquipo = nombreEquipo && porcentaje > 0;
            const tieneTransporte = nombreTransporte && porcentajeTransporte > 0;
            const tieneManoObra = descripcionMano && cantidadMano > 0 && valorUnitarioMano > 0;
            
            // Si no tiene ningún item, marcar error
            if (!tieneEquipo && !tieneTransporte && !tieneManoObra) {
                if (nombreEquipo || nombreTransporte || descripcionMano) {
                    if (nombreEquipo && porcentaje === 0) {
                        errores.push(`Fila ${filaNum}: Equipo "${nombreEquipo}" tiene porcentaje 0%`);
                    }
                    if (nombreTransporte && porcentajeTransporte === 0) {
                        errores.push(`Fila ${filaNum}: Transporte "${nombreTransporte}" tiene porcentaje 0%`);
                    }
                    if (descripcionMano && (cantidadMano === 0 || valorUnitarioMano === 0)) {
                        errores.push(`Fila ${filaNum}: Mano de Obra "${descripcionMano}" incompleta (faltan Cantidad o Valor Unitario)`);
                    }
                    if (!nombreEquipo && !nombreTransporte && !descripcionMano) {
                        errores.push(`Fila ${filaNum}: Debe tener al menos un item (Equipo, Transporte o Mano de Obra)`);
                    }
                } else {
                    errores.push(`Fila ${filaNum}: Debe tener al menos un item (Equipo, Transporte o Mano de Obra)`);
                }
                continue;
            }
            
            // === VALIDAR EQUIPO ===
            if (nombreEquipo || unidadEquipo || porcentaje > 0 || valorBaseEquipo > 0) {
                if (nombreEquipo && porcentaje === 0 && valorBaseEquipo === 0) {
                    errores.push(`Fila ${filaNum}: Equipo "${nombreEquipo}" tiene porcentaje 0% y valor base 0`);
                }
                if (unidadEquipo && unidadEquipo !== '%') {
                    errores.push(`Fila ${filaNum}: Unidad Equipo (%) debe ser "%"`);
                }
                if (nombreEquipo && porcentaje === 0) {
                    errores.push(`Fila ${filaNum}: Equipo "${nombreEquipo}" tiene porcentaje 0%`);
                }
            }
            
            // === VALIDAR TRANSPORTE ===
            if (nombreTransporte || unidadTransporte || porcentajeTransporte > 0 || valorBaseTransporte > 0) {
                if (nombreTransporte && porcentajeTransporte === 0 && valorBaseTransporte === 0) {
                    errores.push(`Fila ${filaNum}: Transporte "${nombreTransporte}" tiene porcentaje 0% y valor base 0`);
                }
                if (unidadTransporte && unidadTransporte !== '%') {
                    errores.push(`Fila ${filaNum}: Unidad Transporte (%) debe ser "%"`);
                }
                if (nombreTransporte && porcentajeTransporte === 0) {
                    errores.push(`Fila ${filaNum}: Transporte "${nombreTransporte}" tiene porcentaje 0%`);
                }
            }
            
            // === VALIDAR MANO DE OBRA ===
            if (descripcionMano || unidadMano || cantidadMano > 0 || valorUnitarioMano > 0) {
                if (descripcionMano && (cantidadMano === 0 || valorUnitarioMano === 0)) {
                    errores.push(`Fila ${filaNum}: Mano de Obra "${descripcionMano}" incompleta (faltan Cantidad o Valor Unitario)`);
                }
                if (cantidadMano > 0 && valorUnitarioMano === 0) {
                    errores.push(`Fila ${filaNum}: Mano de Obra tiene cantidad ${cantidadMano} pero valor unitario 0`);
                }
                if (valorUnitarioMano > 0 && cantidadMano === 0) {
                    errores.push(`Fila ${filaNum}: Mano de Obra tiene valor unitario ${valorUnitarioMano} pero cantidad 0`);
                }
            }
            
            // Detectar categorías nuevas
            if (categoria && !categoriasExistentes.some(c => c.toLowerCase() === categoria.toLowerCase())) {
                if (!categoriasNuevas.includes(categoria)) {
                    categoriasNuevas.push(categoria);
                }
            }
            
            // Guardar código para agrupar
            if (!codigos[codigo]) {
                codigos[codigo] = [];
            }
            codigos[codigo].push(filaNum);
        }
        
        // ===== RESULTADO DE VALIDACIÓN =====
        if (errores.length > 0) {
            console.log('❌ Errores encontrados:', errores.length);
            return res.status(400).json({ 
                success: false,
                error: 'Errores en el archivo',
                detalles: errores,
                totalFilas: data.length,
                erroresEncontrados: errores.length,
                hojaUsada: sheetName
            });
        }
        
        // ===== ÉXITO =====
        console.log('✅ VALIDACIÓN EXITOSA - No se guardaron datos (modo pruebas)');
        console.log('📊 Filas procesadas:', data.length);
        console.log('📁 Códigos APU encontrados:', Object.keys(codigos).length);
        console.log('🆕 Categorías nuevas detectadas:', categoriasNuevas);
        console.log('📋 Hoja usada:', sheetName);
        
        res.json({ 
            success: true,
            message: '✅ Validación exitosa. No se guardaron datos (modo pruebas)',
            filasProcesadas: data.length,
            codigosEncontrados: Object.keys(codigos).length,
            categoriasNuevas: categoriasNuevas,
            hojaUsada: sheetName,
            advertencia: '⚠️ Modo pruebas - Los datos NO se guardaron en el sistema'
        });
        
    } catch (error) {
        console.error('❌ Error al importar APUs:', error);
        res.status(500).json({ error: 'Error al importar: ' + error.message });
    }
});

// ============================================================
// ===== RUTA PARA GENERAR PDF DE APU =====
// ============================================================
app.get('/api/apu-pdf/:id', verificarAutenticacion, async (req, res) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📄 === GENERANDO PDF DE APU ===');
    console.log('🆔 ID solicitado:', req.params.id);
    console.log('👤 Usuario:', req.session?.usuario?.username);
    
    try {
        const PDFDocument = require('pdfkit');
        console.log('✅ PDFKit cargado correctamente');
        
        const apuId = parseInt(req.params.id);
        console.log('🔢 ID parseado:', apuId);
        
        const apuPath = path.join(__dirname, 'data', 'apu.json');
        const empresaPath = path.join(__dirname, 'data', 'empresaInfo.json');
        
        let apuData = null;
        let empresaData = {};
        
        if (fs.existsSync(apuPath)) {
            const data = fs.readFileSync(apuPath, 'utf8');
            const apus = JSON.parse(data);
            apuData = apus.find(a => a.id === apuId);
        }
        
        if (!apuData) {
            return res.status(404).json({ error: 'APU no encontrado' });
        }
        
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
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        
        const pageWidth = doc.page.width - 80;
        let currentY = 40;
        
        // Encabezado
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
            } catch (e) {
                console.error('Error al cargar logo:', e.message);
            }
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
        const empresaNit = empresaData.nit || '';
        const empresaTelefono = empresaData.telefono || '';
        const empresaEmail = empresaData.email || '';
        const empresaDireccion = empresaData.direccion || '';
        const empresaWeb = empresaData.web || '';
        
        let textX = logoX + 10;
        let textY = currentY + 12;
        
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#002735');
        doc.text(empresaNombre.toUpperCase(), textX, textY);
        textY += 20;
        
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        if (empresaNit) {
            doc.text(`NIT: ${empresaNit}`, textX, textY);
            textY += 14;
        }
        if (empresaDireccion) {
            doc.text(`Dirección: ${empresaDireccion}`, textX, textY);
            textY += 14;
        }
        if (empresaTelefono) {
            doc.text(`Teléfono: ${empresaTelefono}`, textX, textY);
            textY += 14;
        }
        if (empresaEmail) {
            doc.text(`Email: ${empresaEmail}`, textX, textY);
            textY += 14;
        }
        if (empresaWeb) {
            doc.text(`Web: ${empresaWeb}`, textX, textY);
            textY += 14;
        }
        
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
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
        
        // Información APU
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
                const newTituloY = currentY;
                doc.fillColor('#002735');
                doc.rect(50, newTituloY, pageWidth, 25).fill();
                doc.fillColor('white');
                doc.fontSize(12).font('Helvetica-Bold');
                doc.text('INFORMACIÓN APU', 55, newTituloY + 7);
                currentY = newTituloY + 25 + 4;
                doc.fillColor('#0f172a');
                doc.fontSize(9).font('Helvetica');
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
            const headerY = y;
            doc.fillColor('#002735');
            doc.rect(50, headerY, pageWidth, 20).fill();
            doc.fillColor('white');
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('NOMBRE', colX[0] + 5, headerY + 5);
            doc.text('UNIDAD', colX[1] + 5, headerY + 5);
            doc.text('PORCENTAJE', colX[2] + 5, headerY + 5);
            doc.text('VALOR BASE', colX[3] + 5, headerY + 5);
            doc.text('SUBTOTAL', colX[4] + 5, headerY + 5);
            y += 20;
            doc.fillColor('#0f172a');
            doc.fontSize(9).font('Helvetica');
            let subtotalEquipos = 0;
            for (let i = 0; i < equipos.length; i++) {
                const e = equipos[i];
                const nombre = e.nombre || 'Sin nombre';
                const unidad = e.unidad || '%';
                const porcentaje = e.porcentaje || 0;
                const valorBase = e.valorBase || 0;
                const subtotal = e.subtotal || 0;
                subtotalEquipos += subtotal;
                if (y > doc.page.height - 100) {
                    doc.addPage();
                    y = 50;
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
                    doc.fillColor('#0f172a');
                    doc.fontSize(9).font('Helvetica');
                }
                if (i % 2 === 0) {
                    doc.fillColor('#f8fafc');
                    doc.rect(50, y - 2, pageWidth, 18).fill();
                    doc.fillColor('#0f172a');
                }
                doc.text(nombre.substring(0, 20), colX[0] + 5, y);
                doc.text(unidad, colX[1] + 5, y);
                doc.text(porcentaje + '%', colX[2] + 5, y);
                doc.text(formatearPrecio(valorBase), colX[3] + 5, y);
                doc.text(formatearPrecio(subtotal), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(50, y - 4).lineTo(doc.page.width - 40, y - 4).stroke();
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal Equipos y Herramientas: ${formatearPrecio(subtotalEquipos)}`;
            const subtotalWidth = doc.widthOfString(subtotalText);
            doc.text(subtotalText, doc.page.width - 50 - subtotalWidth, y);
            y += 20;
            currentY = y;
        }
        
        // Transporte
        const transportes = apuData.items?.transporte || [];
        if (transportes.length > 0) {
            const colX = [50, 180, 280, 380, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('TRANSPORTE DE MATERIALES', 50, y);
            y += 18;
            const headerY = y;
            doc.fillColor('#002735');
            doc.rect(50, headerY, pageWidth, 20).fill();
            doc.fillColor('white');
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('NOMBRE', colX[0] + 5, headerY + 5);
            doc.text('UNIDAD', colX[1] + 5, headerY + 5);
            doc.text('PORCENTAJE', colX[2] + 5, headerY + 5);
            doc.text('VALOR BASE', colX[3] + 5, headerY + 5);
            doc.text('SUBTOTAL', colX[4] + 5, headerY + 5);
            y += 20;
            doc.fillColor('#0f172a');
            doc.fontSize(9).font('Helvetica');
            let subtotalTransporte = 0;
            for (let i = 0; i < transportes.length; i++) {
                const t = transportes[i];
                const nombre = t.nombre || 'Sin nombre';
                const unidad = t.unidad || '%';
                const porcentaje = t.porcentaje || 0;
                const valorBase = t.valorBase || 0;
                const subtotal = t.subtotal || 0;
                subtotalTransporte += subtotal;
                if (y > doc.page.height - 100) {
                    doc.addPage();
                    y = 50;
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
                    doc.fillColor('#0f172a');
                    doc.fontSize(9).font('Helvetica');
                }
                if (i % 2 === 0) {
                    doc.fillColor('#f8fafc');
                    doc.rect(50, y - 2, pageWidth, 18).fill();
                    doc.fillColor('#0f172a');
                }
                doc.text(nombre.substring(0, 20), colX[0] + 5, y);
                doc.text(unidad, colX[1] + 5, y);
                doc.text(porcentaje + '%', colX[2] + 5, y);
                doc.text(formatearPrecio(valorBase), colX[3] + 5, y);
                doc.text(formatearPrecio(subtotal), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(50, y - 4).lineTo(doc.page.width - 40, y - 4).stroke();
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal Transporte: ${formatearPrecio(subtotalTransporte)}`;
            const subtotalWidth = doc.widthOfString(subtotalText);
            doc.text(subtotalText, doc.page.width - 50 - subtotalWidth, y);
            y += 20;
            currentY = y;
        }
        
        // Mano de Obra
        const cargos = apuData.items?.cargos || [];
        if (cargos.length > 0) {
            const colX = [50, 200, 320, 420, 500];
            let y = currentY;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('MANO DE OBRA', 50, y);
            y += 18;
            const headerY = y;
            doc.fillColor('#002735');
            doc.rect(50, headerY, pageWidth, 20).fill();
            doc.fillColor('white');
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('DESCRIPCIÓN', colX[0] + 5, headerY + 5);
            doc.text('UNIDAD', colX[1] + 5, headerY + 5);
            doc.text('CANTIDAD', colX[2] + 5, headerY + 5);
            doc.text('VALOR UNIT.', colX[3] + 5, headerY + 5);
            doc.text('SUBTOTAL', colX[4] + 5, headerY + 5);
            y += 20;
            doc.fillColor('#0f172a');
            doc.fontSize(9).font('Helvetica');
            let subtotalCargos = 0;
            for (let i = 0; i < cargos.length; i++) {
                const c = cargos[i];
                const descripcion = c.descripcion || 'Sin cargo';
                const unidad = c.unidad || 'und';
                const cantidad = c.cantidad || 0;
                const valorUnitario = c.valorUnitario || 0;
                const subtotal = c.subtotal || (valorUnitario * cantidad);
                subtotalCargos += subtotal;
                if (y > doc.page.height - 100) {
                    doc.addPage();
                    y = 50;
                    doc.fillColor('#002735');
                    doc.rect(50, y, pageWidth, 20).fill();
                    doc.fillColor('white');
                    doc.fontSize(9).font('Helvetica-Bold');
                    doc.text('DESCRIPCIÓN', colX[0] + 5, y + 5);
                    doc.text('UNIDAD', colX[1] + 5, y + 5);
                    doc.text('CANTIDAD', colX[2] + 5, y + 5);
                    doc.text('VALOR UNIT.', colX[3] + 5, y + 5);
                    doc.text('SUBTOTAL', colX[4] + 5, y + 5);
                    y += 20;
                    doc.fillColor('#0f172a');
                    doc.fontSize(9).font('Helvetica');
                }
                if (i % 2 === 0) {
                    doc.fillColor('#f8fafc');
                    doc.rect(50, y - 2, pageWidth, 18).fill();
                    doc.fillColor('#0f172a');
                }
                doc.text(descripcion.substring(0, 20), colX[0] + 5, y);
                doc.text(unidad, colX[1] + 5, y);
                doc.text(String(cantidad), colX[2] + 5, y);
                doc.text(formatearPrecio(valorUnitario), colX[3] + 5, y);
                doc.text(formatearPrecio(subtotal), colX[4] + 5, y);
                y += 16;
            }
            y += 4;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(50, y - 4).lineTo(doc.page.width - 40, y - 4).stroke();
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal Mano de Obra: ${formatearPrecio(subtotalCargos)}`;
            const subtotalWidth = doc.widthOfString(subtotalText);
            doc.text(subtotalText, doc.page.width - 50 - subtotalWidth, y);
            y += 20;
            currentY = y;
        }
        
        // Total General
        currentY += 10;
        const totalY = currentY;
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(50, totalY, pageWidth, 35).stroke();
        doc.fillColor('#002735');
        doc.rect(50, totalY, pageWidth, 35).fill();
        doc.fillColor('white');
        doc.fontSize(16).font('Helvetica-Bold');
        const totalLabel = 'VALOR UNITARIO TOTAL:';
        doc.text(totalLabel, 65, totalY + 10);
        const totalValue = formatearPrecio(apuData.valor || 0);
        const totalWidth = doc.widthOfString(totalValue);
        doc.text(totalValue, doc.page.width - 50 - totalWidth - 10, totalY + 10);
        currentY = totalY + 40;
        
        // Pie de página
        const totalPages = doc.bufferedPageRange().count || 1;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            const pageHeight = doc.page.height;
            const pageWidthDoc = doc.page.width;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(40, pageHeight - 45).lineTo(pageWidthDoc - 40, pageHeight - 45).stroke();
            doc.fontSize(9).font('Helvetica').fillColor('#94a3b8');
            const pageText = `Página ${i + 1} de ${totalPages}`;
            doc.text(pageText, 50, pageHeight - 35, { align: 'left' });
            const copyrightText = `Creado con Eetud™ - ${new Date().getFullYear()}`;
            const copyrightWidth = doc.widthOfString(copyrightText);
            doc.text(copyrightText, (pageWidthDoc - copyrightWidth) / 2, pageHeight - 35, { align: 'center' });
            const rightsText = 'Todos los derechos reservados.';
            const rightsWidth = doc.widthOfString(rightsText);
            doc.text(rightsText, pageWidthDoc - 50 - rightsWidth, pageHeight - 35, { align: 'right' });
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(40, pageHeight - 30).lineTo(pageWidthDoc - 40, pageHeight - 30).stroke();
        }
        
        doc.end();
        console.log('✅ PDF generado exitosamente');
        
    } catch (error) {
        console.error('❌ ERROR al generar PDF:', error);
        res.status(500).json({ error: 'Error al generar el PDF: ' + error.message });
    }
});

// ============================================================
// ===== RUTA PARA GENERAR PDF DE COTIZACIÓN (CORREGIDA) =====
// ============================================================
app.post('/api/cotizacion-pdf', verificarAutenticacion, async (req, res) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📄 === GENERANDO PDF DE COTIZACIÓN ===');
    console.log('👤 Usuario:', req.session?.usuario?.username);
    
    try {
        const PDFDocument = require('pdfkit');
        const { cotizacion, empresa } = req.body;
        
        if (!cotizacion) {
            return res.status(400).json({ error: 'Datos de cotización incompletos' });
        }
        
        console.log('📋 Cotización:', cotizacion.numero);
        console.log('🏢 Empresa:', empresa.nombre);
        
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
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        
        // ===== LÍMITES REALES DE MARGEN =====
        // doc.page.width = 595.28, margin = 40
        // x inicio = 40, x fin = 555.28
        const MARGEN_IZQ = 40;
        const MARGEN_DER = doc.page.width - 40;  // ≈ 555.28
        const ANCHO_UTIL = MARGEN_DER - MARGEN_IZQ;  // ≈ 515.28
        
        const pageWidth = ANCHO_UTIL;
        let currentY = 40;
        let pageCount = 1;
        
        // ===== ENCABEZADO =====
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, currentY, pageWidth, 90).stroke();
        
        let logoX = MARGEN_IZQ + 15;
        let logoY = currentY + 10;
        let logoCargado = false;
        
        // Intentar cargar logo de la empresa
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
            } catch (e) {
                console.error('Error al cargar logo:', e.message);
            }
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
        
        const empresaNombre = empresa.nombre || 'MI EMPRESA';
        const empresaNit = empresa.nit || '';
        const empresaTelefono = empresa.telefono || '';
        const empresaEmail = empresa.email || '';
        const empresaDireccion = empresa.direccion || '';
        const empresaWeb = empresa.web || '';
        
        let textX = logoX + 10;
        let textY = currentY + 12;
        
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#002735');
        doc.text(empresaNombre.toUpperCase(), textX, textY);
        textY += 20;
        
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        if (empresaNit) {
            doc.text(`NIT: ${empresaNit}`, textX, textY);
            textY += 14;
        }
        if (empresaDireccion) {
            doc.text(`Dirección: ${empresaDireccion}`, textX, textY);
            textY += 14;
        }
        if (empresaTelefono) {
            doc.text(`Teléfono: ${empresaTelefono}`, textX, textY);
            textY += 14;
        }
        if (empresaEmail) {
            doc.text(`Email: ${empresaEmail}`, textX, textY);
            textY += 14;
        }
        if (empresaWeb) {
            doc.text(`Web: ${empresaWeb}`, textX, textY);
            textY += 14;
        }
        
        const fechaTexto = `Fecha de emisión: ${formatearFecha()}`;
        const fechaWidth = doc.widthOfString(fechaTexto);
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        doc.text(fechaTexto, MARGEN_DER - fechaWidth, currentY + 12);
        
        currentY += 95;
        doc.strokeColor('#002735').lineWidth(1.5);
        doc.moveTo(MARGEN_IZQ, currentY).lineTo(MARGEN_DER, currentY).stroke();
        currentY += 20;
        
        // ===== TÍTULO =====
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#002735');
        const titulo = `COTIZACIÓN`;
        const tituloWidth = doc.widthOfString(titulo);
        doc.text(titulo, (doc.page.width - tituloWidth) / 2, currentY);
        currentY += 40;
        
        // ===== INFORMACIÓN DE LA COTIZACIÓN =====
        const infoY = currentY;
        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, infoY, pageWidth, 25).fill();
        doc.fillColor('white');
        doc.fontSize(12).font('Helvetica-Bold');
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
            if (currentY > doc.page.height - 80) {
                doc.addPage();
                currentY = 50;
                pageCount++;
            }
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
        
        // ===== ITEMS DE LA COTIZACIÓN =====
        if (cotizacion.items && cotizacion.items.length > 0) {
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('ITEMS DE LA COTIZACIÓN', MARGEN_IZQ, currentY);
            currentY += 22;
            
            // ============================================================
            // ===== ANCHOS DE COLUMNAS (REDUCIDOS EXCEPTO DESCRIPCIÓN) =====
            // ============================================================
            // Distribución dentro de [MARGEN_IZQ, MARGEN_DER] = [40, 555.28]
            //
            // N°           = 40   (40  → 80)
            // Descripción  = 225  (80  → 305)  ⬅️ AMPLIADA
            // Cantidad     = 55   (305 → 360)
            // Valor Unit.  = 85   (360 → 445)
            // Subtotal     = 110.28 (445 → 555.28)
            //
            // Total: 40 + 225 + 55 + 85 + 110.28 = 515.28 ✅ EXACTO
            // ============================================================
            const colX = [MARGEN_IZQ, MARGEN_IZQ + 40, MARGEN_IZQ + 265, MARGEN_IZQ + 320, MARGEN_IZQ + 405];
            const colWidths = [40, 225, 55, 85, 110.28];
            const headerHeight = 24;

            doc.fillColor('#002735');
            doc.rect(MARGEN_IZQ, currentY, pageWidth, headerHeight).fill();
            doc.fillColor('white');
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('N°', colX[0] + 3, currentY + 7, { align: 'center', width: colWidths[0] - 6 });
            doc.text('DESCRIPCIÓN', colX[1] + 5, currentY + 7, { align: 'center', width: colWidths[1] - 10 });
            doc.text('CANTIDAD', colX[2] + 3, currentY + 7, { align: 'center', width: colWidths[2] - 6 });
            doc.text('VALOR UNIT.', colX[3] + 3, currentY + 7, { align: 'center', width: colWidths[3] - 6 });
            doc.text('SUBTOTAL', colX[4] + 3, currentY + 7, { align: 'center', width: colWidths[4] - 6 });
            currentY += headerHeight;

            // Espacio extra entre encabezado y primer título
            currentY += 14;
            
            let subtotalGeneral = 0;
            doc.fillColor('#0f172a');
            doc.fontSize(9).font('Helvetica');
            
            // ============================================================
            // ===== NUMERACIÓN JERÁRQUICA =====
            // ============================================================
            let contadorTitulo = 0;
            let contadorAPUPorTitulo = {};
            
            // === PASO 1: Numerar títulos ===
            for (let idx = 0; idx < cotizacion.items.length; idx++) {
                const item = cotizacion.items[idx];
                if (item.tipo === 'titulo') {
                    contadorTitulo++;
                    item.numeroMostrar = contadorTitulo + '.';
                    item._idTitulo = contadorTitulo;
                    contadorAPUPorTitulo[contadorTitulo] = 0;
                }
            }
            
            // === PASO 2: Numerar APUs por título ===
            let tituloActual = null;
            for (let idx = 0; idx < cotizacion.items.length; idx++) {
                const item = cotizacion.items[idx];
                
                if (item.tipo === 'titulo') {
                    tituloActual = item;
                } else if (item.tipo === 'apu') {
                    if (tituloActual) {
                        contadorAPUPorTitulo[tituloActual._idTitulo]++;
                        item.numeroMostrar = tituloActual._idTitulo + '.' + contadorAPUPorTitulo[tituloActual._idTitulo];
                        item._idTituloPadre = tituloActual._idTitulo;
                    } else {
                        item.numeroMostrar = 'APU-' + (idx + 1);
                    }
                }
            }
            
            // === PASO 3: Numerar subitems por APU ===
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
            
            // ============================================================
            // ===== RENDERIZAR ITEMS =====
            // ============================================================
            for (let i = 0; i < cotizacion.items.length; i++) {
                const item = cotizacion.items[i];
                doc.fillColor('#0f172a');
                doc.fontSize(9).font('Helvetica');
                
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

                    doc.fillColor('#002735');
                    doc.fontSize(11).font('Helvetica-Bold');
                    doc.text(tituloTexto, MARGEN_IZQ + 5, currentY, { width: tituloAncho });
                    currentY += alturaFila;
                    doc.fillColor('#0f172a');
                    doc.fontSize(9).font('Helvetica');
                } else if (item.tipo === 'apu') {
                    const cantidad = item.cantidad || 0;
                    const valorUnitario = item.valorUnitario || 0;
                    const subtotal = cantidad * valorUnitario;
                    subtotalGeneral += subtotal;

                    var numero = item.numeroMostrar || '';
                    var nombre = item.nombre || 'APU';

                    doc.fontSize(9).font('Helvetica');
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
                    doc.fillColor('#64748b');
                    doc.fontSize(9).font('Helvetica');
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
            
            // Subtotal
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#002735');
            const subtotalText = `Subtotal: ${formatearPrecio(subtotalGeneral)}`;
            const subtotalWidth = doc.widthOfString(subtotalText);
            doc.text(subtotalText, MARGEN_DER - subtotalWidth, currentY);
            currentY += 28;
        }
        
        // ===== AJUSTES (como minitabla) =====
        const ajustes = cotizacion.ajustes || {};
        const adminValor = ajustes.adminValor || 0;
        const imprevistosValor = ajustes.imprevistosValor || 0;
        const utilidadValor = ajustes.utilidadValor || 0;
        const ivaValor = ajustes.ivaValor || 0;
        const totalFinal = ajustes.totalFinal || cotizacion.valorTotalFinal || 0;
        
        if (adminValor > 0 || imprevistosValor > 0 || utilidadValor > 0 || ivaValor > 0) {
            if (currentY + 100 > doc.page.height - 60) {
                doc.addPage();
                currentY = 50;
                pageCount++;
            }

            doc.fontSize(12).font('Helvetica-Bold').fillColor('#002735');
            doc.text('AJUSTES', MARGEN_IZQ, currentY);
            currentY += 20;
            
            const aColX = [MARGEN_IZQ, MARGEN_IZQ + 150, MARGEN_IZQ + 300];
            doc.fillColor('#002735');
            doc.rect(MARGEN_IZQ, currentY, pageWidth, 20).fill();
            doc.fillColor('white');
            doc.fontSize(9).font('Helvetica-Bold');
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
                    if (currentY + 18 > doc.page.height - 60) {
                        doc.addPage();
                        currentY = 50;
                        pageCount++;
                    }
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
        
        // ===== TOTAL FINAL =====
        if (currentY + 50 > doc.page.height - 60) {
            doc.addPage();
            currentY = 50;
            pageCount++;
        }

        const totalY = currentY;
        doc.strokeColor('#002735').lineWidth(2);
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).stroke();
        doc.fillColor('#002735');
        doc.rect(MARGEN_IZQ, totalY, pageWidth, 40).fill();
        doc.fillColor('white');
        doc.fontSize(16).font('Helvetica-Bold');
        const totalLabel = 'TOTAL COTIZACIÓN:';
        doc.text(totalLabel, MARGEN_IZQ + 15, totalY + 12);
        const totalValue = formatearPrecio(totalFinal);
        const totalWidth = doc.widthOfString(totalValue);
        doc.text(totalValue, MARGEN_DER - totalWidth - 10, totalY + 12);
        currentY = totalY + 45;
        
        // ===== PIE DE PÁGINA =====
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(range.start + i);
            const pageHeight = doc.page.height;
            const pageWidthDoc = doc.page.width;
            doc.strokeColor('#e2e8f0').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, pageHeight - 45).lineTo(MARGEN_DER, pageHeight - 45).stroke();
            doc.fontSize(9).font('Helvetica').fillColor('#94a3b8');
            const pageText = `Página ${i + 1} de ${totalPages}`;
            doc.text(pageText, MARGEN_IZQ, pageHeight - 35, { align: 'left' });
            const copyrightText = `Creado con Eetud™ - ${new Date().getFullYear()}`;
            const copyrightWidth = doc.widthOfString(copyrightText);
            doc.text(copyrightText, (pageWidthDoc - copyrightWidth) / 2, pageHeight - 35, { align: 'center' });
            const rightsText = 'Todos los derechos reservados.';
            const rightsWidth = doc.widthOfString(rightsText);
            doc.text(rightsText, MARGEN_DER - rightsWidth, pageHeight - 35, { align: 'right' });
            doc.strokeColor('#002735').lineWidth(1);
            doc.moveTo(MARGEN_IZQ, pageHeight - 30).lineTo(MARGEN_DER, pageHeight - 30).stroke();
        }
        
        doc.end();
        console.log('✅ PDF de cotización generado exitosamente');
        
    } catch (error) {
        console.error('❌ ERROR al generar PDF de cotización:', error);
        console.error('📋 Stack:', error.stack);
        res.status(500).json({ error: 'Error al generar el PDF: ' + error.message });
    }
});

// ============================================================
// ===== RUTAS PARA IMPORTAR/EXPORTAR MATERIALES =====
// ============================================================

// Ruta para descargar el formato de materiales
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
        console.error('❌ Error al exportar formato:', error);
        res.status(500).json({ error: 'Error al exportar formato' });
    }
});

// Ruta para importar materiales desde Excel
app.post('/api/materiales/importar', verificarAutenticacion, (req, res) => {
    console.log('📂 === IMPORTANDO MATERIALES ===');
    
    try {
        const XLSX = require('xlsx');
        const { file } = req.body;
        
        if (!file) {
            return res.status(400).json({ error: 'No se recibió el archivo' });
        }
        
        const buffer = Buffer.from(file, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        console.log('📊 Datos importados:', data.length);
        
        if (data.length === 0) {
            return res.status(400).json({ error: 'El archivo está vacío' });
        }
        
        const headers = Object.keys(data[0]);
        const requiredHeaders = ['Nombre', 'Proveedor', 'Unidad', 'Precio Unitario'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        
        if (missingHeaders.length > 0) {
            return res.status(400).json({ 
                error: `Faltan columnas: ${missingHeaders.join(', ')}`,
                required: requiredHeaders
            });
        }
        
        const materiales = [];
        let errores = [];
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const nombre = String(row['Nombre'] || '').trim();
            const proveedor = String(row['Proveedor'] || '').trim();
            const unidad = String(row['Unidad'] || '').trim();
            const precio = parseFloat(String(row['Precio Unitario'] || '0').replace(/[$,.]/g, '').trim());
            
            if (!nombre) {
                errores.push(`Fila ${i + 2}: Nombre vacío`);
                continue;
            }
            if (!proveedor) {
                errores.push(`Fila ${i + 2}: Proveedor vacío`);
                continue;
            }
            if (!unidad) {
                errores.push(`Fila ${i + 2}: Unidad vacía`);
                continue;
            }
            if (isNaN(precio) || precio <= 0) {
                errores.push(`Fila ${i + 2}: Precio inválido`);
                continue;
            }
            
            let id = parseInt(row['ID'] || '0');
            if (isNaN(id) || id <= 0) {
                id = null;
            }
            
            materiales.push({
                id: id,
                nombre: nombre,
                proveedor: proveedor,
                unidad: unidad,
                precio: precio
            });
        }
        
        if (errores.length > 0) {
            return res.status(400).json({ 
                error: 'Errores en el archivo',
                detalles: errores,
                materiales: materiales
            });
        }
        
        console.log('✅ Materiales procesados:', materiales.length);
        res.json({ 
            success: true, 
            materiales: materiales,
            message: `Se importaron ${materiales.length} materiales correctamente`
        });
        
    } catch (error) {
        console.error('❌ Error al importar materiales:', error);
        res.status(500).json({ error: 'Error al importar: ' + error.message });
    }
});

// ===== RUTA PARA GUARDAR MATERIALES DESDE EL CLIENTE =====
app.post('/api/materiales/guardar', verificarAutenticacion, (req, res) => {
    console.log('💾 === GUARDANDO MATERIALES EN EL SERVIDOR ===');
    console.log('📦 Cantidad de materiales:', req.body.length);
    
    try {
        const dataPath = path.join(__dirname, 'data');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        
        const materialesPath = path.join(dataPath, 'materiales.json');
        fs.writeFileSync(materialesPath, JSON.stringify(req.body, null, 2));
        
        console.log('✅ Materiales guardados en el servidor:', req.body.length);
        res.json({ success: true, message: 'Materiales guardados en el servidor' });
    } catch (error) {
        console.error('❌ Error al guardar materiales:', error);
        res.status(500).json({ error: 'Error al guardar materiales' });
    }
});

// ===== RUTA PARA BORRAR USUARIOS (SOLO PRUEBAS) =====
app.post('/api/borrar-usuarios', (req, res) => {
    try {
        const dataPath = path.join(__dirname, 'data');
        
        const sessionsPath = path.join(dataPath, 'sessions');
        if (fs.existsSync(sessionsPath)) {
            const files = fs.readdirSync(sessionsPath);
            files.forEach(file => {
                fs.unlinkSync(path.join(sessionsPath, file));
            });
        }
        
        const usuariosPath = path.join(dataPath, 'usuarios.json');
        if (fs.existsSync(usuariosPath)) {
            fs.unlinkSync(usuariosPath);
        }
        
        const empresaPath = path.join(dataPath, 'empresaInfo.json');
        if (fs.existsSync(empresaPath)) {
            fs.unlinkSync(empresaPath);
        }
        
        const archivosDatos = ['proyectos.json', 'cotizaciones.json', 'herramientas.json', 'empleados.json', 'materiales.json', 'apu.json'];
        archivosDatos.forEach(archivo => {
            const filePath = path.join(dataPath, archivo);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });
        
        const archivosVacios = ['proyectos', 'cotizaciones', 'herramientas', 'empleados', 'materiales', 'apu'];
        archivosVacios.forEach(archivo => {
            const filePath = path.join(dataPath, archivo + '.json');
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, JSON.stringify([]));
            }
        });
        
        res.json({ success: true, message: 'Todos los datos han sido eliminados' });
    } catch (e) {
        console.log('Error al borrar usuarios:', e);
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

// ===== RUTA DE PRUEBA PARA VERIFICAR SESIÓN =====
app.get('/api/verificar-sesion', (req, res) => {
    res.json({
        sessionID: req.sessionID,
        session: req.session,
        usuario: req.session?.usuario || null
    });
});

// ===== INICIAR SERVIDOR =====
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📂 Presiona Ctrl+Click en el enlace para abrir`);
});