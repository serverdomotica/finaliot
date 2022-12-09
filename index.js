require('dotenv').config();

// REQUERIR MODULOS
const express = require('express'); // Requerir biblioteca EXPRESS
const socketIo = require('socket.io'); // Requerir biblioteca SOCKET
const http = require('http'); // Requerir biblioteca HTTP para el servidor
const path = require('path');
var bodyParser = require('body-parser'); // Requerir para analizar el cuerpo (body) de peticiones http
const passport = require('passport');
const cookieParser = require('cookie-parser')
const session = require('express-session')
const PassportLocal = require('passport-local').Strategy;
flash = require('connect-flash');
const mqtt = require('mqtt')
const { jsPDF } = require("jspdf");
const autoTable = require("jspdf-autotable");
const createCsvWriter = require('csv-writer').createObjectCsvWriter; // Biblioteca para generar .csv
const multer = require('multer') // Para trabajar con imagenes
var fs = require('fs');
var compression = require('compression');
var request = require('request');

// Variables para identificar la plataforma
var id_plataforma = "dt1n6";
var ruta_alerta = "https://serverdomoticaiot.herokuapp.com/enviar-alerta";
var suscripcion_topic_escribir = id_plataforma + "/server_iot/escribir";
var suscripcion_topic_leer = id_plataforma + "/server_iot/leer";

// Configuracion de objeto para lo de guardar imagenes
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'public/logos'), // Carpeta donde se guardaran los logos
    filename: (req, file, cb) => {
        var id = req.body.id_usuario;
        cb(null, id + path.extname(file.originalname).toLocaleLowerCase()); // El nombre de la img sera el id del usuario
    }
});

// CREAR SERVIDOR
const app = express();
app.set('port', process.env.PORT || 3000); // Que tome el puerto del sistema operativo, sino que tome el 3000
const server = http.createServer(app); // Servidor funcionando
server.listen(app.get('port')); // Inicia el servidor htpp en el puerto
const io = socketIo(server, {
    // Tiempo en el que detecte la desconexion de usuarios sockets
    pingInterval: 20000,
    pingTimeout: 20000
});

// MOTOR DE PLANTILLA
app.set('views', path.join(__dirname, 'view'));
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

// MIDDLEWARES
app.use(multer({
    storage: storage,
    dest: path.join(__dirname, 'public/logos')  // Carpeta donde se guardaran las imagenes
}).single('input-logo')); // Trabajar con cargas de una sola imagen

app.use(bodyParser.json()); // body en formato json
app.use(bodyParser.urlencoded({ extended: false })); // body formulario

// CARPETAS PUBLICAS
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'node_modules')));

app.use(compression());                         // Añadir compresion al servidor

// MONGODB
var mongoose = require("mongoose");
var uri = "mongodb+srv://cliente:soluxpro@cluster0.";
uri = uri + id_plataforma + ".mongodb.net/test?retryWrites=true&w=majority"
// Conexion con la base de datos en la nube
mongoose.connect(uri, { useUnifiedTopology: true, useNewUrlParser: true, useCreateIndex: true }, function (err, db) {
    if (db) {
        console.log("Conexion con la base de datos de forma exitosa")
    }
});

// APP
app.use(cookieParser('mi secreto'));
app.use(session({
    secret: 'mi secreto',
    resave: true,
    saveUninitialized: true
}));
app.use(flash());
app.use((passport.initialize()));
app.use(passport.session());

passport.use(new PassportLocal(function (username, password, done) {

    if ((username == "admin") && (password == "1234"))
        return done(null, { id: 1, permiso_edicion: 1, logo: 0 })

    Usuarios.findOne({ 'usuario': username }, function (err, doc) {

        if (err) return done(null, false, { message: 'Error al verificar. Vuelva a intentar' });
        if (doc) { // Si el id esta registrado
            var clave = doc.clave;

            if (clave == password) {
                var id_usuario = doc._id;
                var permiso_edicion = doc.permiso_edicion;
                var logo = doc.logo;
                return done(null, { id: id_usuario, permiso_edicion: permiso_edicion, logo: logo })
            } else
                return done(null, false, { message: 'Contraseña incorrecta' });
        } else // Si el id no esta registrado
            return done(null, false, { message: 'El ID no pertenece a ningún dispositivo' });
    }).select({ clave: 1, id_usuario: 1, permiso_edicion: 1, logo: 1 }).lean();
}));

passport.serializeUser(function (datos, done) {
    done(null, datos);
});
passport.deserializeUser(function (datos, done) {
    done(null, { id: datos.id, permiso_edicion: datos.permiso_edicion, logo: datos.logo });
});

// WEB-PUSH
// Suscribir cliente para notificaciones webpush
const webpush = require('web-push');
webpush.setVapidDetails(
    'mailto:moises080297@gmail.com',
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY
);
app.post('/subscription', async (req, res) => {
    var id_usuario = req.session.passport.user.id;
    var endpoint = req.body.endpoint;
    console.log("Suscripcion:", id_usuario)

    Suscriptores_Notificaciones.findOne({ 'id_usuario': id_usuario, 'endpoint': endpoint }, function (err, doc) {
        if (err) return false;
        if (doc) {
            console.log("Endpoint ya esta presente");
        } else {
            var suscriptores_notificaciones = new Suscriptores_Notificaciones({
                id_usuario, endpoint,
                suscriptor: req.body
            }).save(function (err, result) {
                if (result) {
                    console.log("Endpoint registrado")
                    res.status(200).json();
                }
            });
        }
    });
});

// Definicion de variables
const clientes_socket = {};
var formato_fecha = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" };
var valor_variables = {};
var id_dispositivos = {};
var datos_eventos = [];
var objeto_acciones_eventos = {};

// SOCKET
io.on('connection', function (socket) {

    // Control web
    socket.on('Control-Web', function (data) {
        if (data) {
            var id_usuario = data.id_usuario;
            var id_dispositivo = data.id_dispositivo;
            var id_variable = data.id_variable;
            var val = data.val;
            var fecha = new Date();

            // Actualizar objeto
            valor_variables[id_variable] = val;

            // Registrar en base de datos
            Val_Variables.findOne({ 'id_usuario': id_usuario, 'id_variable': id_variable }, function (err, doc) {
                if (doc) {
                    doc.fecha = fecha;
                    doc.val = val;
                    doc.save(function (err, result) {
                        if (err) {
                            console.log(err);
                            return false;
                        }
                    });
                }
            });

            // Enviar a todos los dashboard del usuario
            var json_datos_tablero = {};
            json_datos_tablero["id_variable"] = id_variable;
            json_datos_tablero["val_variable"] = val;
            io.sockets.in(id_usuario).emit('Val_Variables', json_datos_tablero);

            // Enviar al dispositivo por MQTT
            var val_variable = {};
            val_variable[id_variable] = val;
            val_variable["e-" + id_variable] = 1;
            var topic_enviar = "server_iot/" + id_usuario + "/" + id_dispositivo;
            client.publish(topic_enviar, JSON.stringify(val_variable));
            console.log("Control web>> Enviado a :", topic_enviar, val_variable);
        }
    });

    // Conexion de las webApp
    socket.on('WebApp', function (id_usuario) {
        console.log('WebApp ' + id_usuario + ' conectado');

        socket.join(id_usuario);
        socket.join(socket.id);
        clientes_socket[socket.id] = id_usuario;

        Variables.find({ "id_usuario": id_usuario }, function (err, doc) {
            if (err) return false
            if (doc) {
                var cantidad_variables = parseInt(doc.length);
                var id_variables = [];
                for (var i = 0; i < cantidad_variables; i++) {
                    id_variables[i] = doc[i]._id;
                }
                for (i = 0; i < cantidad_variables; i++) {
                    Val_Variables.find({ "id_usuario": id_usuario, "id_variable": id_variables[i] }, function (err2, doc2) {
                        if (err2) return false
                        if (doc2) {
                            if (parseInt(doc2.length) > 0) {
                                var fecha = doc2[0].fecha;
                                fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                                io.sockets.in(socket.id).emit('Val_Variables', {
                                    fecha,
                                    id_variable: doc2[0].id_variable,
                                    val_variable: doc2[0].val
                                });
                            }
                        }
                    }).limit(1).sort({ $natural: -1 }).select({ fecha: 1, id_variable: 1, val: 1 }).lean();;
                }
            }
        }).select({ _id: 1 }).lean();
    });
    // Evento socket: Consultar grafica
    socket.on('Consultar-Grafica', function (data) {
        //console.log(data);

        var id_usuario = data.id_usuario;
        var id_widget = data.id_widget;
        var id_variable = data.id_variable;
        var fecha_inicio = data.fecha_inicio
        var fecha_final = data.fecha_final

        Consultar_Grafica(id_usuario, id_widget, id_variable, fecha_inicio, fecha_final, socket.id)
    });
    // Evento socket: Consultar tablas
    socket.on('Consultar-Tabla', function (data) {
        //console.log(data);

        var id_usuario = data.id_usuario;
        var id_widget = data.id_widget;
        var id_variables = data.id_variables;
        var fecha_inicio = data.fecha_inicio
        var fecha_final = data.fecha_final

        var cantidad_columnas = parseInt(id_variables.length)

        var columnas = {};
        var fechas = [];
        var datos_tabla = [];
        var cantidad = 0;

        for (i = 0; i < cantidad_columnas; i++) {
            Val_Variables.find({ "id_usuario": id_usuario, "id_variable": id_variables[i], "fecha": { "$gte": fecha_inicio, "$lte": fecha_final } }, function (err1, doc1) {
                if (err1) return false
                if (doc1) {
                    var cantidad_datos = parseInt(doc1.length);
                    if (cantidad_datos == 0) {
                        io.sockets.in(socket.id).emit('Datos_Tabla', id_widget, cantidad_columnas, datos_tabla);
                    } else {
                        var inicio = 0;
                        if (cantidad_datos > 200) {
                            inicio = cantidad_datos - 200;
                        }
                        for (var i = inicio; i < cantidad_datos; i++) {
                            var aux_fecha = doc1[i].fecha;
                            var fecha_ms = new Date(aux_fecha).getTime();
                            val_variable = doc1[i].val;
                            if (columnas[fecha_ms])
                                columnas[fecha_ms] = columnas[fecha_ms] + "," + val_variable;
                            else
                                columnas[fecha_ms] = val_variable;

                            if (fechas.indexOf(fecha_ms) == -1) {
                                fechas.push(fecha_ms)
                            }

                            if (i == (cantidad_datos - 1)) {
                                cantidad++;
                                if (cantidad == cantidad_columnas) {
                                    var cantidad_fechas = parseInt(fechas.length);
                                    for (var j = 0; j < cantidad_fechas; j++) {
                                        var aux_dato = columnas[fechas[j]];
                                        if (cantidad_columnas > 1) {
                                            aux_dato = aux_dato.split(',');
                                            var cantidad_aux_dato = parseInt(aux_dato.length);
                                            if (cantidad_aux_dato == cantidad_columnas) {
                                                var aux_datos_tabla = fechas[j];
                                                for (var d = 0; d < cantidad_aux_dato; d++) {
                                                    aux_datos_tabla = aux_datos_tabla + "*" + aux_dato[d];
                                                }
                                                // console.log("Dato ", j, " :", aux_datos_tabla)
                                                datos_tabla.push(aux_datos_tabla)
                                            }
                                        } else {
                                            var aux_datos_tabla = fechas[j] + "*" + columnas[fechas[j]];
                                            datos_tabla.push(aux_datos_tabla)
                                        }
                                    }
                                    // console.log(datos_tabla)
                                    io.sockets.in(socket.id).emit('Datos_Tabla', id_widget, cantidad_columnas, datos_tabla);
                                }
                            }
                        }
                    }
                }
            }).select({ fecha: 1, id_variable: 1, val: 1 }).lean();;
        }
    });

    // Consulta de registros
    socket.on('Consulta', function (id_usuario, bd, Fecha_Inicio, Fecha_Final) {
        console.log('Consulta de', id_usuario, '>>:', bd, Fecha_Inicio, Fecha_Final);
        socket.join(socket.id);

        // Consultar la base de datos
        if ((bd == "usuarios") && (id_usuario == "1")) {
            Usuarios.find({ "fecha": { "$gte": Fecha_Inicio, "$lte": Fecha_Final } }, function (err, doc) {
                if (err) return false
                if (doc) {
                    var longitud = parseInt(doc.length);
                    var inicio = 0;
                    var final_trama = 0;
                    for (var i = inicio; i < longitud; i++) {
                        if (i == (longitud - 1))
                            final_trama = 1;
                        var fecha = doc[i].fecha;
                        fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                        io.sockets.in(socket.id).emit('Usuarios', final_trama, {
                            id: doc[i]._id,
                            fecha: fecha,
                            usuario: doc[i].usuario,
                            clave: doc[i].clave,
                            nombre: doc[i].nombre,
                            permiso_edicion: doc[i].permiso_edicion
                        });
                    }
                }
            }).lean();
        } else if (bd == "dispositivos") {
            Dispositivos.find({ "id_usuario": id_usuario, "fecha": { "$gte": Fecha_Inicio, "$lte": Fecha_Final } }, function (err, doc) {
                if (err) return false
                if (doc) {
                    var longitud = parseInt(doc.length);
                    var inicio = 0;
                    var final_trama = 0;
                    for (var i = inicio; i < longitud; i++) {
                        if (i == (longitud - 1))
                            final_trama = 1;
                        var fecha = doc[i].fecha;
                        fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                        io.sockets.in(socket.id).emit('Dispositivos', final_trama, {
                            id: doc[i]._id,
                            fecha: fecha,
                            nombre: doc[i].nombre
                        });
                    }
                }
            }).lean();
        } else if (bd == "estancias") {
            Estancias.find({ "id_usuario": id_usuario, "fecha": { "$gte": Fecha_Inicio, "$lte": Fecha_Final } }, function (err, doc) {
                if (err) return false
                if (doc) {
                    var longitud = parseInt(doc.length);
                    var inicio = 0;
                    var final_trama = 0;
                    for (var i = inicio; i < longitud; i++) {
                        if (i == (longitud - 1))
                            final_trama = 1;
                        var fecha = doc[i].fecha;
                        fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                        io.sockets.in(socket.id).emit('Estancias', final_trama, {
                            id: doc[i]._id,
                            fecha: fecha,
                            nombre: doc[i].nombre,
                            ubicacion: doc[i].ubicacion
                        });
                    }
                }
            }).lean();
        } else if (bd == "variables") {
            Variables.find({ "id_usuario": id_usuario }, function (err, doc) {
                if (err) return false
                if (doc) {
                    var longitud = parseInt(doc.length);
                    var inicio = 0;
                    var final_trama = 0;
                    for (var i = inicio; i < longitud; i++) {
                        if (i == (longitud - 1))
                            final_trama = 1;
                        var fecha = doc[i].fecha;
                        fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                        io.sockets.in(socket.id).emit('Variables', final_trama, {
                            id: doc[i]._id,
                            nombre: doc[i].nombre,
                            unidad_med: doc[i].unidad_med,
                            dispositivo: doc[i].dispositivo
                        });
                    }
                }
            }).lean();
        } else if (bd == "widgets") {
            Widgets.find({ "id_usuario": id_usuario }, function (err, doc) {
                if (err) return false
                if (doc) {
                    var longitud = parseInt(doc.length);
                    var inicio = 0;
                    var final_trama = 0;
                    for (var i = inicio; i < longitud; i++) {
                        if (i == (longitud - 1))
                            final_trama = 1;
                        var fecha = doc[i].fecha;
                        fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                        io.sockets.in(socket.id).emit('Widgets', final_trama, {
                            id: doc[i]._id,
                            nombre: doc[i].nombre,
                            tipo: doc[i].tipo,
                            id_variable: doc[i].id_variable,
                            funcion: doc[i].funcion,
                            estancia: doc[i].estancia
                        });
                    }
                }
            }).lean();
        } else if (bd == "eventos") {
            Eventos.find({ "id_usuario": id_usuario }, function (err, doc) {
                if (err) return false
                if (doc) {
                    var longitud = parseInt(doc.length);
                    var inicio = 0;
                    var final_trama = 0;
                    for (var i = inicio; i < longitud; i++) {
                        if (i == (longitud - 1))
                            final_trama = 1;
                        var fecha = doc[i].fecha;
                        fecha = new Date(fecha).toLocaleString("en-GB", formato_fecha);
                        io.sockets.in(socket.id).emit('Eventos', final_trama, {
                            id: doc[i]._id,
                            anidacion: doc[i].anidacion,
                            condicionales: doc[i].condicionales,
                            acciones: doc[i].acciones
                        });
                    }
                }
            }).lean();
        }
    });
    // Generar reportes
    socket.on('Generar_Reporte_Variable', function (data) {
        console.log('Generar reporte:', data);

        var id_usuario = data.id_usuario;
        var id_widget = data.id_widget;
        var nombre_variable = data.nombre_variable;
        var id_variable = data.id_variable;
        var fecha_inicio = data.fecha_inicio;
        var fecha_final = data.fecha_final;
        var tipo = data.tipo;
        var titulo_reporte = data.titulo_reporte;

        var fecha_inicio_string = new Date(fecha_inicio).toLocaleString("en-GB", formato_fecha);
        var fecha_final_string = new Date(fecha_final).toLocaleString("en-GB", formato_fecha);
        var titulo_reporte2 = "Desde " + fecha_inicio_string + " hasta " + fecha_final_string

        var fecha_reporte = "",
            fecha_reporte2 = "",
            nombre_archivo = "",
            header_nombre = "";

        // Obtener fecha
        let date = new Date()
        let minute = date.getMinutes()
        let hora = date.getHours()
        let day = date.getDate()
        let month = date.getMonth() + 1
        let year = date.getFullYear()
        if (month < 10) {
            fecha_reporte = `${day}-0${month}-${year} ${hora}h-${minute}m`;
            fecha_reporte2 = "Fecha: " + `${day}-0${month}-${year}`;
        } else {
            fecha_reporte = `${day}-${month}-${year} ${hora}h-${minute}m`
            fecha_reporte2 = "Fecha: "
                `${day}-${month}-${year}`
        }

        if (tipo == "PDF") {
            nombre_archivo = fecha_reporte + " " + titulo_reporte + ".pdf";
            header_nombre = nombre_variable;
        } else if (tipo == "CSV") {
            nombre_archivo = fecha_reporte + " " + titulo_reporte + ".csv";
            csvWriter = createCsvWriter({
                path: nombre_archivo,
                header: [
                    { id: 'i', title: 'i' },
                    { id: 'fecha', title: 'Fecha' },
                    { id: 'val', title: nombre_variable },
                ]
            });
        } else {
            io.sockets.in(socket.id).emit('reporte-error', { id_widget });
            return false;
        }

        var oldPath = nombre_archivo;
        var newPath = 'public/' + nombre_archivo;
        var lista2 = [];

        Val_Variables.find({ "id_usuario": id_usuario, "id_variable": id_variable, "fecha": { "$gte": fecha_inicio, "$lte": fecha_final } }, function (err, doc) {
            if (err) return false;
            if (doc) {
                var cantidad_datos = parseInt(doc.length);
                var lista = new Array(cantidad_datos);

                for (var i = 0; i < cantidad_datos; i++) {
                    lista[i] = new Array(3);

                    var fecha = new Date(doc[i].fecha).toLocaleString("en-GB", formato_fecha);
                    var valor = doc[i].val;

                    lista[i][0] = i + 1;
                    lista[i][1] = fecha;
                    lista[i][2] = valor;

                    lista2.push({
                        i: i + 1,
                        fecha: fecha,
                        val: valor
                    })
                }

                if (tipo == "PDF") {
                    var path_url = path.join(__dirname, 'public/img/logopdf.png'),
                        format = 'PNG';
                    var imgData = fs.readFileSync(path_url).toString('base64');

                    const doc_pdf = new jsPDF()
                    doc_pdf.addImage(imgData, 'jpeg', 14, 10, 50, 15);
                    doc_pdf.autoTable({ html: '#Reporte' })
                    doc_pdf.text(14, 33, fecha_reporte2);
                    doc_pdf.text(14, 42, titulo_reporte);
                    doc_pdf.text(14, 51, titulo_reporte2);

                    doc_pdf.autoTable({
                        startY: 57,
                        head: [
                            ["i", "Fecha", header_nombre]
                        ],
                        body: lista
                    })

                    function addFooters(doc) {
                        const pageCount = doc.internal.getNumberOfPages()
                        doc.setFont('helvetica', 'italic')
                        doc.setFontSize(8)
                        for (var i = 1; i <= pageCount; i++) {
                            doc.setPage(i)
                            doc.text('Pag ' + String(i) + ' de ' + String(pageCount), doc.internal.pageSize.width / 2, 287, {
                                align: 'center'
                            })
                        }
                    }

                    addFooters(doc_pdf)
                    doc_pdf.save(nombre_archivo)
                    fs.rename(oldPath, newPath, function (err) {
                        if (err) {
                            io.sockets.in(socket.id).emit('reporte-error', { id_widget });
                            return false;
                        }
                        io.sockets.in(socket.id).emit('reporte-enviado', { id_widget, nombre_archivo });
                    })
                }
                if (tipo == "CSV") {
                    csvWriter.writeRecords(lista2).then(() => {
                        fs.rename(oldPath, newPath, function (err) {
                            if (err) {
                                io.sockets.in(socket.id).emit('reporte-error', { id_widget });
                                return false;
                            }
                            io.sockets.in(socket.id).emit('reporte-enviado', { id_widget, nombre_archivo });
                        })
                    });
                }
            }
        }).select({ fecha: 1, val: 1 }).lean();
    });
});

// RUTAS HTTP
// Ruta: Login
app.get('/', (req, res, next) => {
    if (req.isAuthenticated())
        return next();
    res.render('index.html'); // Si no ha iniciado sesion
}, (req, res) => {
    res.redirect("/tablero"); // Si ya ha iniciado sesion
});
// Ruta: Panel de administrador
app.get('/panel-admin', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id == 1) return next();
        req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    res.render('panel-admin.html'); // Si ya inicio sesion
});
// Ruta: Registro de usuario
app.get('/registro-usuario', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id == 1) return next();
        req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    res.render('registro-usuario.html'); // Si ya inicio sesion
});
// Ruta: Lista de usuarios registrados
app.get('/usuarios', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id == 1) return next();
        req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var id = req.session.passport.user.id; // Si ya inicio sesion
    res.render('usuarios.html', {
        id: id
    }); // Si ya inicio sesion
});
// Ruta: Panel de usuario
app.get('/panel-usuario', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "panel-usuario.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    });
});
// Ruta: Registro de dispositivo
app.get('/registro-dispositivo', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "registro-dispositivo.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    });
});
// Ruta: Lista de dispositivos registrados por usuario
app.get('/dispositivos', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "dispositivos.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    });
});
// Ruta: Registro de estancia
app.get('/registro-estancia', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "registro-estancia.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    });
});
// Ruta: Lista de estancais registradas por usuario
app.get('/estancias', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "estancias.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    });
});
// Ruta: Registro de variables
app.get('/registro-variable', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var id = req.session.passport.user.id; // Si ya inicio sesion
    var datos = req.session.passport.user;
    if (datos.permiso_edicion == 1) {
        Dispositivos.find({ "id_usuario": id }, function (err1, doc1) {
            if (err1) return false
            if (doc1) {
                var id_dispositivos = [],
                    dispositivos = [];
                var cantidad_dispositivos = parseInt(doc1.length);
                for (var i = 0; i < cantidad_dispositivos; i++) {
                    id_dispositivos[i] = doc1[i]._id;
                    dispositivos[i] = doc1[i].nombre;
                }
                res.render('registro-variable.html', {
                    datos,
                    cantidad_dispositivos,
                    id_dispositivos,
                    dispositivos
                });
            }
        }).select({ _id: 1, nombre: 1 }).lean();
    } else {
        res.render("sin-permiso-edicion.html", {
            datos
        }); // Si ya inicio sesion
    }
});
// Ruta: Lista de variables registradas por usuario
app.get('/variables', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "variables.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    }); // Si ya inicio sesion
});
// Ruta: Registro de widgets
app.get('/registro-widget', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var id = req.session.passport.user.id; // Si ya inicio sesion
    var datos = req.session.passport.user;
    if (datos.permiso_edicion == 1) {
        Estancias.find({ "id_usuario": id }, function (err, doc) {
            if (err) return false
            if (doc) {
                var id_estancias = [],
                    estancias = [],
                    id_variables = [],
                    variables = [],
                    dispositivos_variables = [];
                var cantidad_estancias = parseInt(doc.length);
                for (var i = 0; i < cantidad_estancias; i++) {
                    id_estancias[i] = doc[i]._id;
                    estancias[i] = doc[i].nombre;
                }
                Variables.find({ "id_usuario": id }, function (err1, doc1) {
                    if (err1) return false
                    if (doc1) {
                        var cantidad_variables = parseInt(doc1.length);
                        for (var i = 0; i < cantidad_variables; i++) {
                            id_variables[i] = doc1[i]._id;
                            variables[i] = doc1[i].nombre;
                            dispositivos_variables[i] = doc1[i].dispositivo;
                        }
                        res.render('registro-widget.html', {
                            datos,
                            cantidad_estancias,
                            id_estancias,
                            estancias,
                            cantidad_variables,
                            id_variables,
                            variables,
                            dispositivos_variables
                        });
                    }
                }).select({ _id: 1, nombre: 1, dispositivo: 1 }).lean();
            }
        }).select({ _id: 1, nombre: 1 }).lean();
    } else {
        res.render("sin-permiso-edicion.html", {
            datos
        });
    }
});
// Ruta: Lista de widgets registrados por usuario
app.get('/widgets', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var html_render = "widgets.html";
    if (datos.permiso_edicion == 0)
        html_render = "sin-permiso-edicion.html";
    res.render(html_render, {
        datos
    }); // Si ya inicio sesion
});
// Ruta: Registro de eventos
app.get('/registro-evento', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var id = req.session.passport.user.id;
    if (datos.permiso_edicion == 1) {
        Variables.find({ "id_usuario": id }, function (err1, doc1) {
            if (err1) return false
            if (doc1) {
                var cantidad_variables = parseInt(doc1.length);
                var id_variables = [], variables = [], dispositivos_variables = [];
                for (var i = 0; i < cantidad_variables; i++) {
                    id_variables[i] = doc1[i]._id;
                    variables[i] = doc1[i].nombre;
                    dispositivos_variables[i] = doc1[i].dispositivo;
                }
                res.render('registro-eventos.html', {
                    datos,
                    cantidad_variables,
                    id_variables,
                    variables,
                    dispositivos_variables
                });
            }
        }).select({ _id: 1, nombre: 1, dispositivo: 1 }).lean();
    } else {
        res.render("sin-permiso-edicion.html", {
            datos
        });
    }
});
// Ruta: Lista de eventos registrados por usuario
app.get('/eventos', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var datos = req.session.passport.user;
    var id = req.session.passport.user.id;
    if (datos.permiso_edicion == 1) {
        Variables.find({ "id_usuario": id }, function (err1, doc1) {
            if (err1) return false
            if (doc1) {
                var cantidad_variables = parseInt(doc1.length);
                var id_variables = [], variables = [], dispositivos_variables = [];
                for (var i = 0; i < cantidad_variables; i++) {
                    id_variables[i] = doc1[i]._id;
                    variables[i] = doc1[i].nombre;
                    dispositivos_variables[i] = doc1[i].dispositivo;
                }
                res.render('eventos.html', {
                    datos,
                    id_variables,
                    variables,
                    dispositivos_variables
                });
            }
        }).select({ _id: 1, nombre: 1, dispositivo: 1 }).lean();
    } else {
        res.render("sin-permiso-edicion.html", { datos });
    }
});
// Ruta: Tablero o dashboard
app.get('/tablero', (req, res, next) => {
    if (req.isAuthenticated()) {
        var id = req.session.passport.user.id;
        console.log("id: " + id)
        if (id != 1)
            return next();
        else
            req.logout();
    }
    res.redirect("/") // Si no ha iniciado sesion
}, (req, res) => {
    var id = req.session.passport.user.id;
    var datos = req.session.passport.user;
    console.log("Buscando estancias");
    Estancias.find({ "id_usuario": id }, function (err1, doc1) {
        if (err1) return false
        if (doc1) {
            var id_estancias = [],
                estancias = [];
            var cantidad_estancias = parseInt(doc1.length);
            for (var i = 0; i < cantidad_estancias; i++) {
                id_estancias[i] = doc1[i]._id;
                estancias[i] = doc1[i].nombre;
            }
            console.log("Buscando variables");
            Variables.find({ "id_usuario": id }, function (err2, doc2) {
                if (err2) return false
                if (doc2) {
                    var id_variables = [],
                        variables = [],
                        unidad_med_variables = [],
                        objeto_unidad_med_variables = {},
                        id_dispositivos_variables = [],
                        dispositivos2_variables = [],
                        dispositivos_variables = {};
                    var cantidad_variables = parseInt(doc2.length);
                    for (var i = 0; i < cantidad_variables; i++) {
                        var id_v = doc2[i]._id;
                        id_variables[i] = doc2[i]._id;
                        variables[i] = doc2[i].nombre;
                        unidad_med_variables[i] = doc2[i].unidad_med;
                        objeto_unidad_med_variables[id_v] = doc2[i].unidad_med;
                        id_dispositivos_variables[i] = doc2[i].id_dispositivo;
                        dispositivos2_variables[i] = doc2[i].dispositivo;
                        dispositivos_variables[id_v] = doc2[i].dispositivo;
                    }
                    console.log("Buscando widgets");
                    Widgets.find({ "id_usuario": id }, function (err3, doc3) {
                        if (err3) return false
                        if (doc3) {
                            var id_widgets = [],
                                widgets = [],
                                tipo_widgets = [],
                                id_variables_widgets = [],
                                variables_widgets = [];
                            var min_widgets = [],
                                max_widgets = [],
                                id_estancias_widgets = [],
                                estancias_widgets = [];
                            var msj_off_widgets = [],
                                msj_on_widgets = [],
                                funcion_widgets = [];
                            var titulos_tablas_widgets = {}, titulos_id_variables_tablas_widgets = {}, id_variables_tablas_widgets = [];
                            var cantidad_columnas_tablas_widgets = {}
                            var cantidad_widgets = parseInt(doc3.length);
                            for (var i = 0; i < cantidad_widgets; i++) {
                                id_widgets[i] = doc3[i]._id;
                                widgets[i] = doc3[i].nombre;
                                tipo_widgets[i] = doc3[i].tipo;
                                id_variables_widgets[i] = doc3[i].id_variable;
                                variables_widgets[i] = doc3[i].variable;
                                min_widgets[i] = doc3[i].min;
                                max_widgets[i] = doc3[i].max;
                                msj_off_widgets[i] = doc3[i].msj_off;
                                msj_on_widgets[i] = doc3[i].msj_on;
                                funcion_widgets[i] = doc3[i].funcion;
                                id_estancias_widgets[i] = doc3[i].id_estancia;
                                estancias_widgets[i] = doc3[i].estancia;

                                // Tablas
                                array_id_variables_tablas = [];
                                if (tipo_widgets[i] == "Tabla") {
                                    // Cantidad de columnas
                                    var titulos_tabla = doc3[i].titulos_tabla;
                                    cantidad_columnas_tablas_widgets[id_widgets[i]] = titulos_tabla.length;
                                    // Titulos de las columnas
                                    titulos_tablas_widgets[id_widgets[i]] = titulos_tabla;
                                    // ID variable para cada columna (en objeto)
                                    titulos_id_variables_tablas_widgets[id_widgets[i]] = doc3[i].id_variables_tabla;
                                    // ID variable para cada columna (en array)
                                    var aux_id_variables_tablas = doc3[i].id_variables_tabla;
                                    aux_id_variables_tablas = aux_id_variables_tablas.join('-');
                                    id_variables_tablas_widgets.push(aux_id_variables_tablas);
                                }
                            }

                            id_variables_tablas_widgets = id_variables_tablas_widgets.join();

                            res.render('tablero.html', {
                                datos,
                                cantidad_estancias,
                                id_estancias,
                                estancias,
                                cantidad_variables,
                                id_variables,
                                variables,
                                unidad_med_variables,
                                objeto_unidad_med_variables,
                                id_dispositivos_variables,
                                dispositivos2_variables,
                                dispositivos_variables,
                                cantidad_widgets,
                                id_widgets,
                                widgets,
                                tipo_widgets,
                                id_variables_widgets,
                                variables_widgets,
                                cantidad_columnas_tablas_widgets,
                                titulos_tablas_widgets,
                                titulos_id_variables_tablas_widgets,
                                id_variables_tablas_widgets,
                                min_widgets,
                                max_widgets,
                                id_estancias_widgets,
                                estancias_widgets,
                                msj_off_widgets,
                                msj_on_widgets,
                                funcion_widgets
                            });
                        }
                    }).lean();
                }
            }).lean();
        }
    }).lean();
});

app.get('/prueba', (req, res) => { res.render('prueba.html'); });

app.get('/sistema-usuario', (req, res) => {
    if (req.isAuthenticated())
        res.send("cierto")
    else {
        var mensaje_error = req.flash('error')[0]
        res.send(mensaje_error)
    }
});
app.get('/sistema-admin', (req, res) => {
    if (req.isAuthenticated())
        res.send("/panel-admin")
    else
        res.send("fallo")
});

app.post('/login-usuario', passport.authenticate('local', {
    successRedirect: "/sistema-usuario",
    failureRedirect: "/sistema-usuario",
    failureFlash: true // Para enviar informacion
}));
app.post('/login-admin', passport.authenticate('local', {
    successRedirect: "/sistema-admin",
    failureRedirect: "/sistema-admin",
    failureFlash: false
}));

// Registros
app.post('/datos-registro-bd', (req, res) => {
    var bd = req.body.bd;

    if (req.isAuthenticated()) {
        var id_usuario = req.session.passport.user.id;
        console.log("Registro >> ", bd, "Por parte de:", id_usuario, "Data:", req.body);

        if (bd == "usuarios") {
            var usuario = req.body.usuario;
            var clave = req.body.clave;
            var nombre = req.body.nombre;

            console.log(usuario);
            Usuarios.findOne({ 'usuario': usuario }, function (err, doc) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                if (doc) { // Si ya esta registrado
                    console.log('Ya existe');
                    res.send("Ya existe");
                } else { // Si no esta registrado

                    var fecha = new Date();
                    var usuarios = new Usuarios({
                        fecha,
                        usuario,
                        clave,
                        nombre,
                        permiso_edicion: 1,
                        logo: "logo.png"
                    }).save(function (err1, result) {
                        if (err1) {
                            res.send("Error");
                            return false;
                        }
                        var aux_id_usuario = result._id;

                        var estancias = new Estancias({
                            fecha,
                            id_usuario: aux_id_usuario,
                            nombre: "...",
                            ubicacion: ""
                        }).save(function (err2,result1) {
                            if (err2) {
                                res.send("Error");
                                return false;
                            }
                            var aux_id_usuario1 = result1._id;
                            console.log("Registrado")
                            res.send(aux_id_usuario+"/"+fecha+"/"+aux_id_usuario1);
                        });

                    });
                }
            });
        } else if (bd == "dispositivos") {
            var nombre = req.body.nombre;
            Dispositivos.findOne({ 'id_usuario': id_usuario, 'nombre': nombre }, function (err, doc) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                if (doc) { // Si ya esta registrado
                    console.log('Ya existe');
                    res.send("Ya existe");
                } else { // Si no esta registrado aun
                    var fecha = new Date();
                    var dispositivos = new Dispositivos({
                        fecha,
                        id_usuario,
                        nombre
                    }).save(function (err1,result) {
                        if (err1) {
                            res.send("Error");
                            return false;
                        }
                        var aux_id_usuario = result._id;
                        console.log("Registrado");
                        res.send(fecha+"/"+id_usuario+"/"+nombre+"/"+aux_id_usuario);

                    });
                }
            });
        } else if (bd == "estancias") {
            var nombre = req.body.nombre;
            var ubicacion = req.body.ubicacion;

            Estancias.findOne({ 'id_usurio': id_usuario, 'estancia': nombre }, function (err, doc) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                if (doc) { // Si ya esta registrado
                    console.log('Ya existe');
                    res.send("Ya existe");
                } else { // Si no esta registrado aun
                    var fecha = new Date();
                    var estancias = new Estancias({
                        fecha,
                        id_usuario,
                        nombre,
                        ubicacion
                    }).save(function (err1, result1) {
                        if (err1) {
                            res.send("Error");
                            return false;
                        }
                        var aux_id_usuario = result1._id;
                        console.log("Registrado")
                        res.send(fecha+"/"+id_usuario+"/"+nombre+"/"+aux_id_usuario+"/"+ubicacion);
                    });
                }
            });
        } else if (bd == "variables") {
            var nombre = req.body.nombre;
            var id_dispositivo = req.body.id_dispositivo;
            var dispositivo = req.body.dispositivo;
            var unidad_med = req.body.unidad_medida;

            Variables.findOne({ 'id_usuario': id_usuario, 'id_dispositivo': id_dispositivo, 'nombre': nombre }, function (err, doc) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                if (doc) { // Si ya esta registrado
                    console.log('Ya existe');
                    res.send("Ya existe");
                } else { // Si no esta registrado aun
                    var variables = new Variables({
                        id_usuario,
                        nombre,
                        unidad_med,
                        id_dispositivo,
                        dispositivo

                    }).save(function (err1, result) {
                        if (err1) {
                            res.send("Error");
                            return false;
                        }
                        var id_variable = result._id;
                        var fecha = new Date();
                        var val_variables = new Val_Variables({
                            fecha,
                            id_usuario,
                            id_variable,
                            val: 0
                        }).save(function (err2,result1) {
                            if (err2) {
                                res.send("Error");
                                return false;
                            }
                            var id_variable1 = result1._id;
                            console.log("Registrado")
                            res.send(id_usuario+"/"+id_variable+"/"+fecha+"/"+unidad_med+"/"+id_dispositivo+"/"+dispositivo+"/"+nombre+"/"+id_variable1);
                        });
                    });
                }
            });
        } else if (bd == "widgets") {
            var titulos_tabla = [], id_variables_tabla = [];

            var tipo = req.body.tipo;
            var nombre = req.body.nombre;
            var id_variable = req.body.id_variable;
            var variable = req.body.variable;
            var min = req.body.min;
            var max = req.body.max;
            var id_estancia = req.body.id_estancia;
            var estancia = req.body.estancia;
            var msj_off = req.body.msj_off;
            var msj_on = req.body.msj_on;
            var funcion = req.body.funcion;

            if (tipo == "Tabla") {
                // Columnas de la tabla
                var columnas_tabla = variable.split("*");
                variable = "";
                var cantidad_columnas_tabla = parseInt(columnas_tabla.length);
                for (var i = 1; i < cantidad_columnas_tabla; i++) {
                    var columna = columnas_tabla[i].toString();
                    var json_columna = JSON.parse(columna);
                    var nombre_columna_tabla = json_columna["nombre_col"];
                    var id_variable_columna_tabla = json_columna["id_variable"];
                    titulos_tabla.push(nombre_columna_tabla);
                    id_variables_tabla.push(id_variable_columna_tabla);
                }
            }

            Widgets.findOne({ 'id_usuario': id_usuario, 'id_estancia': id_estancia, 'nombre': nombre }, function (err, doc) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                if (doc) { // Si ya esta registrado
                    console.log('Ya existe');
                    res.send("Ya existe");
                } else { // Si no esta registrado aun
                    var widgets = new Widgets({
                        id_usuario,
                        nombre,
                        tipo,
                        id_variable,
                        variable,
                        titulos_tabla,
                        id_variables_tabla,
                        min,
                        max,
                        msj_off,
                        msj_on,
                        funcion,
                        id_estancia,
                        estancia
                    }).save(function (err1,result) {
                        if (err1) {
                            res.send("Error");
                            return false;
                        }
                        var id_variable1 = result._id;
                        console.log("Registrado")
                        res.send(id_variable1+"/"+id_usuario+"/"+nombre+"/"+tipo+"/"+id_variable+"/"+variable+"/"+titulos_tabla+"/"+id_variables_tabla+"/"+min+"/"+max+"/"+msj_off+"/"+msj_on+"/"+funcion+"/"+id_estancia+"/"+estancia);
                    });
                }
            });
        } else if (bd == "eventos") {
            var anidacion = req.body.anidacion;
            // Condicciones
            var condicionales = req.body.condicionales;
            condicionales = condicionales.split("*");
            var cantidad_condiciones = parseInt(condicionales.length);
            var datos_condicionales = [];
            for (var i = 1; i < cantidad_condiciones; i++) {
                var condicional = condicionales[i].toString();
                var json_condicional = JSON.parse(condicional);
                datos_condicionales.push(json_condicional)
            }
            console.log(datos_condicionales);
            // Acciones
            var acciones = req.body.acciones;
            acciones = acciones.split("*");
            var cantidad_acciones = parseInt(acciones.length);
            var datos_acciones = [];
            for (var i = 1; i < cantidad_acciones; i++) {
                var accion = acciones[i].toString();
                var json_accion = JSON.parse(accion);
                datos_acciones.push(json_accion)
            }
            console.log(datos_acciones);

            var eventos = new Eventos({
                id_usuario,
                anidacion,
                condicionales: datos_condicionales,
                acciones: datos_acciones
            }).save(function (err1,result1) {
                if (err1) {
                    res.send("Error");
                    return false;
                }
                var aux_id_usuario = result1._id;

                console.log("Registrado")
                res.send(id_usuario+"/"+datos_condicionales+"/"+datos_acciones+"/"+aux_id_usuario);
            });
        }
    }
});
// Editar registros
app.post('/datos-editar-usuario', (req, res) => {
  console.log(req.body)
  var id_usuario = req.body.id;
  var usuario = req.body.usuario;
  var clave = req.body.clave;
  var nombre = req.body.nombre;
  var permiso_edicion = req.body.permiso_edicion;
  permiso_edicion = parseInt(permiso_edicion);

  Usuarios.findById(id_usuario, function (err, doc) {
      if (doc) {
          console.log("user:", doc)
          doc.usuario = usuario;
          doc.clave = clave;
          doc.nombre = nombre;
          doc.permiso_edicion = permiso_edicion;
          doc.save(function (err, result) {
              if (err) {
                  console.log(err);
                  res.send({ mensaje: "Error" })
                  return false;
              }
              console.log("Modificado");
              res.send({ mensaje: "Modificado",id:id_usuario,usuario:usuario,clave:clave,nombre:nombre,permiso_edicion:permiso_edicion })
          });
      }
  });
});
// Editar LOGO
app.post('/modificacion-logo', (req, res) => {
    var id_usuario = req.body.id_usuario;
    var logo = req.file.filename;

    console.log(id_usuario, logo)
    if ((id_usuario) && (logo)) {
        Usuarios.findById(id_usuario, function (err, doc) {
            if (err) {
                res.send("Error");
                return false;
            }
            if (doc) {
                doc.logo = logo;
                doc.save(function (err, result) {
                    if (err) {
                        console.log(err);
                        res.send("Error");
                        return false;
                    }
                    if (result) {
                        res.send("Modificado");
                    }
                });
            }
        });
    }
});
// Eliminar registros
app.post('/eliminar-registro-bd', (req, res) => {
    var id = req.body.id;
    var bd = req.body.bd;

    if (req.isAuthenticated()) {
        var id_usuario = req.session.passport.user.id;
        console.log('Eliminar por', id_usuario, '>>:', bd, ":", id);

        if ((bd == "usuarios") && (id_usuario == "1")) {
            Usuarios.deleteOne({ '_id': id }, function (err, result) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                Dispositivos.deleteMany({ 'id_usuario': id }, function (err2) {
                    if (err2) {
                        res.send("Error");
                        return false;
                    }
                    Estancias.deleteMany({ 'id_usuario': id }, function (err3) {
                        if (err3) {
                            res.send("Error");
                            return false;
                        }
                        Variables.deleteMany({ 'id_usuario': id }, function (err4) {
                            if (err4) {
                                res.send("Error");
                                return false;
                            }
                            Widgets.deleteMany({ 'id_usuario': id }, function (err5) {
                                if (err5) {
                                    res.send("Error");
                                    return false;
                                }
                                Val_Variables.deleteMany({ 'id_usuario': id }, function (err6) {
                                    if (err6) {
                                        res.send("Error");
                                        return false;
                                    }
                                    console.log("Eliminado")
                                    res.send("Eliminado");
                                });
                            });
                        });
                    });
                });
            });
        }
        if (bd == "dispositivos") {
            Dispositivos.deleteOne({ '_id': id }, function (err) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                Variables.deleteMany({ 'id_dispositivo': id }, function (err2) {
                    if (err2) {
                        res.send("Error");
                        return false;
                    }
                    console.log("Eliminado")
                    res.send("Eliminado");
                });
            });
        }
        if (bd == "estancias") {
            Estancias.deleteOne({ '_id': id }, function (err) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                Widgets.deleteMany({ 'id_estancia': id }, function (err2) {
                    if (err2) {
                        res.send("Error");
                        return false;
                    }
                    console.log("Eliminado")
                    res.send("Eliminado");
                });
            });
        }
        if (bd == "variables") {
            Variables.deleteOne({ '_id': id }, function (err) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                Val_Variables.deleteMany({ 'id_variable': id }, function (err2) {
                    if (err2) {
                        res.send("Error");
                        return false;
                    }
                    console.log("Eliminado")
                    res.send("Eliminado");
                });
            });
        }
        if (bd == "widgets") {
            Widgets.deleteOne({ '_id': id }, function (err) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                console.log("Eliminado")
                res.send("Eliminado");
            });
        }
        if (bd == "eventos") {
            Eventos.deleteOne({ '_id': id }, function (err) {
                if (err) {
                    res.send("Error");
                    return false;
                }
                console.log("Eliminado")
                res.send("Eliminado");
            });
        }
    } else {
        res.send("Error");
    }
});

// Enviar notificaciones
app.post('/enviar-alerta', async (req, res) => {
    var id_usuario = req.body.id_usuario;
    var titulo = req.body.titulo_notificacion;
    var contenido = req.body.contenido_notificacion;
    console.log("Enviar webpush:", id_usuario, titulo, contenido)

    Suscriptores_Notificaciones.find({ 'id_usuario': id_usuario }, function (err, doc) {
        if (err) return false;
        if (doc) {
            var longitud = parseInt(doc.length);
            console.log("Cantidad de suscriptores en", id_usuario, ":", longitud)
            for (i = 0; i < longitud; i++) {
                const payload = JSON.stringify({ title: titulo, message: contenido })
                try {
                    for (i = 0; i < longitud; i++) {
                        //await webpush.sendNotification(doc[i].suscriptor, payload);
                        webpush.sendNotification(doc[i].suscriptor, payload);
                    }
                } catch (error) {
                    console.log(error);
                }
            }
        }
    });
});

app.post('/cerrar-sesion', (req, res) => {
    req.logout();
    res.send("ok")
});

// Variables de la base de datos para los usuarios
var user_schema1 = new mongoose.Schema({
    fecha: Date,
    usuario: String,
    clave: String,
    nombre: String,
    permiso_edicion: Number,
    logo: String
}, { versionKey: false });
// Crear un modelo en la base de datos en el que estaran los registros
var Usuarios = mongoose.model("usuarios", user_schema1);

// Variables de la base de datos para los dispositivos
var user_schema2 = new mongoose.Schema({
    fecha: Date,
    id_usuario: String,
    nombre: String
}, { versionKey: false });
// Crear un modelo en la base de datos en el que estaran los registros
var Dispositivos = mongoose.model("dispositivos", user_schema2);

// Variables de la base de datos para las estancias
var user_schema3 = new mongoose.Schema({
    fecha: Date,
    id_usuario: String,
    nombre: String,
    ubicacion: String
}, { versionKey: false });
// Crear un modelo en la base de datos en el que estaran los registros
var Estancias = mongoose.model("estancias", user_schema3);

// Variables de la base de datos para las variables
var user_schema4 = new mongoose.Schema({
    id_usuario: String,
    nombre: String,
    unidad_med: String,
    id_dispositivo: String,
    dispositivo: String
}, { versionKey: false });
// Crear un modelo en la base de datos en el que estaran los registros
var Variables = mongoose.model("variables", user_schema4);

// Variables de la base de datos para los widget
var user_schema5 = new mongoose.Schema({
    id_usuario: String,
    nombre: String,
    tipo: String,
    id_variable: String,
    variable: String,
    titulos_tabla: Array,
    id_variables_tabla: Array,
    min: String,
    max: String,
    msj_on: String,
    msj_off: String,
    funcion: String,
    id_estancia: String,
    estancia: String
}, { versionKey: false });
// Crear un modelo en la base de datos en el que estaran los registros
var Widgets = mongoose.model("widgets", user_schema5);

// Variables de la base de datos para los valores de las variables
var user_schema6 = new mongoose.Schema({
    // fecha: Date,
    // id_usuario: String,
    // id_variable: String,
    // val: String
    fecha: {
        type: Date,
        index: true
    },
    id_usuario: {
        type: String,
        index: true
    },
    id_variable: {
        type: String,
        index: true
    },
    val: {
        type: String,
        index: true
    }
}, { versionKey: false });
// Crear un modelo en la base de datos en el que estaran los registros
var Val_Variables = mongoose.model("val_variables", user_schema6);

// Variables de la base de datos para los valores de los suscriptores
var user_schema7 = new mongoose.Schema({
    id_usuario: String,
    endpoint: String,
    suscriptor: Object
}, { versionKey: false });
var Suscriptores_Notificaciones = mongoose.model("suscriptores_notificaciones", user_schema7);

// Variables de la base de datos para los valores de los eventos
var user_schema8 = new mongoose.Schema({
    id_usuario: String,
    anidacion: String,
    condicionales: Object,
    acciones: Object
}, { versionKey: false });
var Eventos = mongoose.model("eventos", user_schema8);

function Consultar_Grafica(id_usuario, id_widget, id_variable, fecha_inicio, fecha_final, id_webapp) {
    io.sockets.in(id_webapp).emit('Limpiar-Grafica', { id_widget });

    // Consultar la base de datos
    Val_Variables.find({ "id_usuario": id_usuario, "id_variable": id_variable, "fecha": { "$gte": fecha_inicio, "$lte": fecha_final } }, function (err, doc) {
        if (err) return false;
        if (doc) {
            var cantidad_datos = parseInt(doc.length);
            var inicio = 0;
            var final = cantidad_datos;

            var resolucion = 1;
            if (cantidad_datos > 200)
                resolucion = parseInt(cantidad_datos / 200);

            var lista = [];

            var val_variable = [], fecha_variable = [];

            for (var i = inicio; i < final; i += resolucion) {
                var fecha_string = new Date(doc[i].fecha).toLocaleString("en-GB", formato_fecha);

                var val = doc[i].val;
                lista.push(parseFloat(val));

                val_variable.push(val);
                fecha_variable.push(fecha_string);
            }

            io.sockets.in(id_webapp).emit('Llenar-Grafica', {
                id_widget,
                fecha: fecha_variable,
                val: val_variable
            });

            var min = Math.min.apply(null, lista);
            var max = Math.max.apply(null, lista);

            io.sockets.in(id_webapp).emit('Max_min', {
                id_widget,
                min,
                max
            });
        }
    }).select({ fecha: 1, val: 1 }).lean();
}

// MQTT
const client = mqtt.connect('mqtt://test.mosquitto.org', { maximum_packet_size: 268435450 })

// MQTT- Conexion
client.on('connect', () => {
    console.log("Conectado a MQTT");

    client.subscribe(suscripcion_topic_escribir, function (err) {
        if (err) {
            console.log("Error al suscribir a topic MQTT", err);
            return false;
        }
        console.log("Suscrito a: ", suscripcion_topic_escribir);
    })
    client.subscribe(suscripcion_topic_leer, function (err) {
        if (err) {
            console.log("Error al suscribir a topic MQTT", err);
            return false;
        }
        console.log("Suscrito a: ", suscripcion_topic_leer);
    })
})
// MQTT- Mensajes de entrada
client.on('message', (topic, message) => {
    var aux_mensaje = message.toString();

    try {
        var json_mensaje = JSON.parse(aux_mensaje);

        if (json_mensaje) {
            var id_usuario = json_mensaje["token"];
            var id_dispositivo = json_mensaje["id_dispositivo"];

            if (topic == suscripcion_topic_escribir) {
                //console.log('Topic>>', topic, ':', json_mensaje)
                var longitud_datos = Object.keys(json_mensaje).length;
                var parametros_datos = Object.keys(json_mensaje);

                var json_datos_tablero = {};
                var fecha = new Date();
                for (var i = 0; i < longitud_datos; i++) {
                    if ((parametros_datos[i] != "token") && (parametros_datos[i] != "id_dispositivo")) {
                        var id_variable = parametros_datos[i];
                        var val_variable = json_mensaje[id_variable]
                        // Actualizar objeto
                        valor_variables[id_variable] = val_variable;
                        // Enviar al dashboard
                        json_datos_tablero["id_variable"] = id_variable;
                        json_datos_tablero["val_variable"] = val_variable;
                        json_datos_tablero["dispositivo"] = 1;
                        json_datos_tablero["fecha"] = new Date().toLocaleString("en-US", formato_fecha);
                        io.sockets.in(id_usuario).emit('Val_Variables', json_datos_tablero);
                        //console.log("Escritura MQTT>>", id_variable, val_variable);
                        // Verificar eventos
                        Verificar_Evento(id_usuario, id_dispositivo, id_variable)
                        // Registrar valores en base de datos
                        var val_variables = new Val_Variables({
                            fecha,
                            id_usuario,
                            id_variable,
                            val: val_variable
                        }).save();
                    }
                }
            }
            if (topic == suscripcion_topic_leer) {
                // Encontrar todas las variables del dispositivo
                var variables_dispositivo = id_dispositivos[id_dispositivo];
                if (variables_dispositivo) {
                    variables_dispositivo = variables_dispositivo.split(",");
                    var cantidad_variables = parseInt(variables_dispositivo.length);
                    var val_variables = {};
                    for (var i = 0; i < cantidad_variables; i++) {
                        var id_variable = variables_dispositivo[i];
                        val_variables[id_variable] = valor_variables[id_variable];
                    }
                    val_variables["consulta_general"] = 1;
                    var topic_enviar = "server_iot/" + id_usuario + "/" + id_dispositivo;
                    client.publish(topic_enviar, JSON.stringify(val_variables));
                    //console.log("Lectura MQTT>>", val_variables);
                }
            }
        }
    } catch {
        console.log("Error al leer json_mensaje", topic);
        return false;
    }
});

// Funcion: Verificar evento
function Verificar_Evento(id_usuario, id_dispositivo, id_variable) {
    var cantidad_datos = parseInt(datos_eventos.length);
    // Verificar eventos del usuario
    for (i = 0; i < cantidad_datos; i++) {
        if (datos_eventos[i].id_usuario == id_usuario) {
            var anidacion = datos_eventos[i].anidacion;
            var condicionales = datos_eventos[i].condicionales;
            var cantidad_condicionales = parseInt(condicionales.length);
            var cantidad_suma = 0;
            var aux_evento = 0;
            for (var j = 0; j < cantidad_condicionales; j++) {
                // Chequear el tipo de condicion (==, !=, >, <)
                if (condicionales[j].id_variable == id_variable)
                    aux_evento = 1;

                var valor_condicion = parseFloat(condicionales[j].val);
                if (condicionales[j].val_id_variable != "0") {
                    valor_condicion = parseFloat(valor_variables[condicionales[j].val_id_variable])
                }

                //console.log("Valor variable, valor condicion:", valor_variables[condicionales[j].id_variable], valor_condicion)

                if (condicionales[j].tipo == "0") {
                    if (parseFloat(valor_variables[condicionales[j].id_variable]) == valor_condicion) {
                        cantidad_suma++;
                    }
                } else if (condicionales[j].tipo == "1") {
                    if (parseFloat(valor_variables[condicionales[j].id_variable]) != valor_condicion) {
                        cantidad_suma++;
                    }
                } else if (condicionales[j].tipo == "2") {
                    if (parseFloat(valor_variables[condicionales[j].id_variable]) > valor_condicion) {
                        cantidad_suma++;
                    }
                } else if (condicionales[j].tipo == "3") {
                    if (parseFloat(valor_variables[condicionales[j].id_variable]) < valor_condicion) {
                        cantidad_suma++;
                    }
                }
            }
            // Validar si se cumplieron las condiciones de los eventos solo si el evento generado tiene relacion con la variable recibida
            var estado_evento = 0;
            if (aux_evento == 1) {
                // AND
                if ((anidacion == "0") && (cantidad_suma == cantidad_condicionales)) {
                    estado_evento = 1;
                }
                // OR
                if ((anidacion == "1") && (cantidad_suma > 0)) {
                    estado_evento = 1;
                }
                // Evento
                if (estado_evento == 1) {
                    var acciones = datos_eventos[i].acciones;
                    var cantidad_acciones = parseInt(acciones.length);
                    for (var a = 0; a < cantidad_acciones; a++) {
                        // Notificaciones push
                        if (acciones[a].tipo == 0) {
                            console.log("Evento notificacion")
                            var tiempo = parseInt(acciones[a].tiempo) * 60000;
                            console.log("Tiempo:", tiempo, " ms")
                            var tiempo_ult = parseInt(acciones[a].tiempo_ult);
                            console.log("Tiempo ult:", tiempo_ult, " ms")
                            var tiempo_actual = new Date()
                            tiempo_actual = tiempo_actual.getTime()
                            console.log("Tiempo actual:", tiempo_actual, " ms")
                            // Verificar si ya paso el tiempo minimo
                            if ((tiempo_ult + tiempo) <= tiempo_actual) {
                                // Actualizar objeto
                                datos_eventos[i].acciones[a].tiempo_ult = tiempo_actual;
                                var id_evento = datos_eventos[i]._id
                                objeto_acciones_eventos[id_evento] = datos_eventos[i].acciones
                                console.log("Se dio la notificacion", datos_eventos[i].acciones[a].tiempo_ult, tiempo_actual)
                                // Enviar notificacion
                                var titulo_notificacion = acciones[a].titulo;
                                var contenido_notificacion = acciones[a].contenido;
                                console.log("Notificacion>> Titulo:", titulo_notificacion, "Contenido:", contenido_notificacion)
                                var json_notificacion = { id_usuario, titulo_notificacion, contenido_notificacion };
                                request({
                                    //url: "http://localhost:3000/enviar-alerta", // Si lo vas a probar de forma local
                                    url: ruta_alerta,
                                    method: "POST",
                                    json: true,
                                    body: json_notificacion
                                });
                                // Actualizar tiempo ultimo de la notificacion
                                Eventos.findOne({ '_id': id_evento }, function (err, doc) {
                                    if (doc) {
                                        doc.acciones = objeto_acciones_eventos[doc._id]
                                        doc.save(function (err, result) {
                                            if (err) {
                                                console.log(err);
                                                return false;
                                            }
                                        });
                                    }
                                });
                            }
                        }
                        // Control
                        if (acciones[a].tipo == 1) {
                            var id_variable_control = acciones[a].id_variable;
                            var val_variable_control = acciones[a].val;
                            console.log("Control>> ID Variable:", id_variable_control, "Valor:", val_variable_control)
                            // Actualizar base de datos
                            var fecha = new Date();
                            // Actualizar objeto
                            valor_variables[id_variable_control] = val_variable_control;
                            // Registrar en base de datos
                            Val_Variables.findOne({ 'id_usuario': id_usuario, 'id_variable': id_variable_control }, function (err, doc) {
                                if (doc) {
                                    doc.fecha = fecha;
                                    doc.val = valor_variables[doc.id_variable]
                                    doc.save(function (err, result) {
                                        if (err) {
                                            console.log(err);
                                            return false;
                                        }
                                    });
                                }
                            });
                            // Enviar a todos los dashboard del usuario
                            var json_datos_tablero = {};
                            json_datos_tablero["id_variable"] = id_variable_control;
                            json_datos_tablero["val_variable"] = val_variable_control;
                            io.sockets.in(id_usuario).emit('Val_Variables', json_datos_tablero);
                            // Enviar al dispositivo por MQTT
                            var val_variable = {};
                            val_variable[id_variable_control] = val_variable_control;
                            val_variable["e-" + id_variable_control] = 1;
                            var topic_enviar = "server_iot/" + id_usuario + "/" + id_dispositivo;
                            client.publish(topic_enviar, JSON.stringify(val_variable));
                            console.log("Topic>>", topic_enviar, val_variable)
                        }
                    }
                }
            }
        }
    }
}
// Funcion: Consultar variables
function Consultar_Variables() {
    setTimeout(function () {
        Consultar_Variables();
        var fecha1 = new Date().getTime();
        Variables.find(function (err, doc) {
            if (err) return false;
            if (doc) {
                var fecha2 = new Date().getTime();
                //console.log("Consulta:", fecha2 - fecha1)
                var cantidad_variables = parseInt(doc.length);
                var variables = [];
                id_dispositivos = {};
                for (var i = 0; i < cantidad_variables; i++) {
                    var id_variable = doc[i]._id;
                    var id_dispositivo = doc[i].id_dispositivo;

                    variables[i] = id_variable;
                    if (id_dispositivos[id_dispositivo])
                        id_dispositivos[id_dispositivo] = id_dispositivos[id_dispositivo] + "," + id_variable;
                    else
                        id_dispositivos[id_dispositivo] = id_variable;
                }
                for (var i = 0; i < cantidad_variables; i++) {
                    Val_Variables.find({ 'id_variable': variables[i] }, function (err2, doc2) {
                        if (err2) return false;
                        if (doc2) {
                            if (parseInt(doc2.length) > 0) {
                                var id_variable = doc2[0].id_variable;
                                var val = doc2[0].val;
                                valor_variables[id_variable] = val;
                            }
                        }
                    }).limit(1).sort({ $natural: -1 }).select({ id_variable: 1, val: 1 }).lean();
                }
            }
        }).select({ _id: 1, id_dispositivo: 1 }).lean();
    }, 10000, "JavaScript");
}
Consultar_Variables();
// Funcion: Consultar eventos
function Consultar_Eventos() {
    setTimeout(function () {
        Consultar_Eventos();
        Eventos.find(function (err, doc) {
            if (err) return false;
            if (doc) {
                var cantidad_datos = parseInt(doc.length);
                datos_eventos = [];
                for (i = 0; i < cantidad_datos; i++) {
                    datos_eventos.push(doc[i]);
                }
            }
        }).select({ id_usuario: 1, anidacion: 1, condicionales: 1, acciones: 1 }).lean();
    }, 30000, "JavaScript");
};
Consultar_Eventos();
