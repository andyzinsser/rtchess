// var process.env.PWD = __dirname;
// Heroku API for __dirname
process.env.PWD = process.cwd();
// var application_root = process.cwd();
var express = require('express');
var path = require('path');
var Seq = require('seq');
var EventEmitter = require('events').EventEmitter;
var _ = require('underscore');
var request = require('request');

// Models
var Room = require('./models/room');

// Controllers
var Board = require('./lib/board');
var config = require('./lib/config');
var common = require('./lib/common');

var logger = console;
var express = require("express");
var app = express();
var http = require('http');
var server = http.createServer(app);
var io = require('socket.io').listen(server, { log: false });
var mongoose = require('mongoose');
var db_credentials = process.env.BULLET_CHESS_DB_CREDENTIALS;
mongoose.connect(db_credentials);

// true when we are running in production
var production = process.env.NODE_ENV === 'production';

app.configure(function(){
    var bundle = require('browserify')(process.env.PWD + '/lib/client.js');
    app.use(bundle);
    app.use(require('connect-less')({ src: process.env.PWD, debug:true }));
    app.use(express['static'](path.join(process.env.PWD, 'static')));

    app.use(express.cookieParser());
    app.use(express.session({secret: 'chessCanBeKewl12121hhJUJ'}));
});

app.configure('development', function() {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function() {
    // setup javascript minification
    // app.use(require('minj').middleware({ src: process.env.PWD}));

    // var oneYear = 31557600000;
    // app.use(express.staticCache());
    // app.use(express['static'](path.join(process.env.PWD, 'static'), {maxAge: oneYear}));
    // app.use(express.errorHandler());
});

app.configure(function(){
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(app.router);
    app.set('views', path.join(process.env.PWD, 'views'));
    app.set('view engine', 'html');
    app.engine('html', require('hbs').__express);
});

app.use(function(err, req, res, next){
    res.send(500, { error: 'Sorry something went wrong!' });
});

process.on('uncaughtException', function(err) {
    logger.error('UNCAUGHT EXCEPTION: --------------------');
    logger.error(err);
    logger.error(err.stack);
    logger.error('----------------------------------------');
});

io.configure(function() {
    io.set('transports', ['xhr-polling']);
    // io.set('transports', ['jsonp-polling']);
    io.set("polling duration", 10);
});


// Setup sockets
//
io.sockets.on('connection', function(socket) {

    socket.on('disconnect', function(socket) {
      console.log('Got disconnect!');
   });

    socket.on('ping', function() {
        socket.emit('pong');
    });

    socket.on('init', function(room_id) {
        socket.join(room_id);
        Room.findOne({id: room_id}, function(err, room) {
            if (!err && room) {
                room.connected_players ++;
                room.save();
            }
        });
    });

    socket.on('playerClickedStart', function(room_id) {
        console.log("player clicked start");
        Room.findOne({id: room_id}, function(err, room) {
            if (!err && room) {
                room.players_clicked_start ++;
                room.save();
                if (room.allPlayersPressedStart()) {
                    io.sockets['in'](room.id).emit('starting', config.START_WAIT_SECS);
                }
            }
        });
    });

    // TODO:
    // Set up a router for each event
    // When ever one client triggers an event
    // io.sockets.in(room.id).emit(THE EVENT, ROOM_MODEL);
});



// Create a new game and list current games the user is in
//

app.get('/', function(req, res) {
    Room.find({$or: [{white_session_id: req.session.id}, {black_session_id: req.session.id}]}, function(err, docs) {
        return res.render('index', {
            title: 'Bet BTC on Chess',
            open_games: docs,
            session_id: req.session.id
        });
    });
});


// About Bullet Chess
//
app.get('/about', function(req, res) {
    return res.render('about', {
        title: 'Bullet Chess'
    });
});


// Setting up to use a full http request so that we can
// store info in the session object (instead of just emitting a signal)
app.post('/register-arbiter-user', function(req, res) {
    req.session.arbiter_user_id = req.body.arbiter_user_id;
    res.end();
});


// Looks for an open room or creates a new one if none are open.
// Then the redirect the user to that room
//
app.get('/new_room', function(req, res) {
    // Before creating a new game, check if there are any open games
    Room
        .where('black_session_id').equals(null)
        .where('white_session_id').ne(req.session.id).exec(function(err, docs) {
            var room = docs[0];
            if (room) {
                room.black_session_id = req.session.id;
                room.save();
            }
            else {
                room = new Room({
                    for_bitcoin: parseBool(req.query.for_bitcoin),
                    white_session_id: req.session.id,
                    id: common.randomString(10)
                });
                room.markModified('sides');
                room.markModified('starting');
                room.save();
            }
            return res.redirect('/r/' + room.id);
    });
});


// Load up the Game Room
//
app.get('/r/:room_id', function(req, res) {
    var ev = new EventEmitter(),
        buyInInProgress = false,
        room_id = req.param('room_id'),
        room;

    var checkIfArbiterGameIsReady = function() {
        var gameIsReady = true;

        if (!room.arbiter_id) {
            gameIsReady = false;
            createChallengeOnArbiter();
        }

        if (!req.session.arbiter_token) {
            gameIsReady = false;
            createArbiterTokenForUser();
        }

        // After we are sure the game is setup on Arbiter and the user is authenticated
        // Have them buy into the game
        if (gameIsReady) {
            if (room.bought_in_arbiter_tokens.indexOf(req.session.arbiter_token) === -1) {
                gameIsReady = false;
                if (!buyInInProgress) {
                    buyIntoRoom();
                }
            } else {
                console.log(room);
                renderArbiterRoom();
            }
        }

        return gameIsReady;
    };

    var createChallengeOnArbiter = function() {
        request.post('https://cointoss.arbiter.me/api/v0.1/challenge/create/?ante=0.001&return_address=1PkBgbVetZGjNMrkLMdzh7kc3eNJooStb4&developer_take=0.0',
            function(err, response, body) {
                var parsed = JSON.parse(body);
                if (parsed.success) {
                    room.arbiter_id = parsed.challenge._id;
                    ev.emit('arbiterSetupProgress');
                }
                else {
                    return res.render('error', {
                        title: "Sorry",
                        error: "Arbiter is down, so wagering bitcoin is temporarily disabled."
                    });
                }
            });
    };

    var createArbiterTokenForUser = function() {
        request.post('https://cointoss.arbiter.me/api/v0.1/token/create/', function(err, response, body) {
            var parsed = JSON.parse(body);
            if (parsed.token) {
                req.session.arbiter_token = parsed.token;
                sessions[parsed.token] = new Session(parsed.token, parsed.private_key);
                ev.emit('arbiterSetupProgress');
            } else {
                return res.render('error', {
                    title: "Sorry",
                    error: "Arbiter is down, so wagering bitcoin is temporarily disabled."
                });
            }
        });
    };

    var buyIntoRoom = function() {
        var at = req.session.arbiter_token;
        var private_key = sessions[at].private_key;
        buyInInProgress = true;
        request.post('https://cointoss.arbiter.me/api/v0.1/challenge/' + room.arbiter_id + '/ante/?arbiter_token=' + at + '&arbiter_private_key=' + private_key,
            function(err, response, body) {
                var parsed = JSON.parse(body);
                buyInInProgress = false;
                if (parsed.auth_url) {
                    return res.render('room', {
                        title: 'Authenticate with Arbiter',
                        room_id: room.id,
                        auth_url: parsed.auth_url,
                        session_id: req.session.id
                    });
                } else if (parsed.errors.length) {
                    return res.render('error', {
                        title: 'Coinbase Error',
                        room_id: room.id,
                        error: 'There was an error transferring your Bitcoin from Coinbase. Make sure you have sufficient funds.' +
                               ' Email: info@arbiter.me if you have any questions.'
                    });
                } else {
                    room.bought_in_arbiter_tokens.push(req.session.arbiter_token);
                    ev.emit('arbiterSetupProgress');
                }
            }
        );
    };

    var renderArbiterRoom = function() {
        return res.render('room', {
            title: 'Real-Time Chess: Game',
            room_id: room.id,
            arbiter_id: room.arbiter_id,
            arbiter_token: req.session.arbiter_token,
            session_id: req.session.id,
            mySide: (req.session.id == room.white_session_id) ? 'white' : 'black'
        });
    };

    // Trigger this event whenever an arbiter field changes on the room model
    ev.on('arbiterSetupProgress', checkIfArbiterGameIsReady);

    // Get the room
    Room.findOne({id: req.param('room_id')}, function(err, doc) {
        if (err || !doc) {
            res.redirect('/');
        }
        room = doc;

        // If some one is hitting the link directly (sent to a friend), then add the friend to the
        // open seat. If the game is full, then redirect the user back to the home page
        if (!room.black_session_id && room.white_session_id !== req.session.id) {
            room.black_session_id = req.session.id;
            room.save();
        } else if (room.white_session_id && room.black_session_id &&
                  (room.white_session_id !== req.session.id && room.black_session_id !== req.session.id)) {
            res.redirect('/');
        }

        // If this is for bitcoin, make sure the user is authed and bought in
        // Otherwise, just start the game
        if (room.for_bitcoin === true) {
            checkIfArbiterGameIsReady();
        }
        else {
            return res.render('room', {
                title: 'Bullet Chess',
                room_id: room.id,
                mySide: (req.session.id == room.white_session_id) ? 'white' : 'black',
                session_id: req.session.id
            });
        }
    });
});


// helpers ========================

// testing route to create 500 error
app.get('/500', function(req, res){
    throw new Error('This is a 500 Error');
});

// testing route to create 404 error
app.get('/404', function(req, res){
    throw new NotFound();
});

// ALWAYS keep as the last route
app.get('*', function(req, res) {
    throw new NotFound();
});

// used to identify 404 pages
function NotFound(msg){
    this.name = 'NotFound';
    Error.call(this, msg);
    Error.captureStackTrace(this, arguments.callee);
}

function parseBool(str) {
    return (str == "true") ? true : false;
}

var port = (production) ? process.env.PORT || 5000 : 8000;

server.listen(port, function() {
    logger.info('server running on port ' + port);
});



// ================================================
// ================================================
// ================================================







// function Session(token, private_key) {
//     this.token = token;
//     this.private_key = private_key;
//     this.side_for_rooms = {};
// }

// var rooms = {};
// var SIDES = ['black', 'white'];
// var sessions = {};

// io.configure(function() {
//     io.set('transports', ['xhr-polling']);
//     // io.set('transports', ['jsonp-polling']);
//     io.set("polling duration", 10);
// });

// io.sockets.on('connection', function(socket) {
//     var room;
//     var mySide;

//     socket.on('ping', function() {
//         socket.emit('pong');
//     });
//     socket.on('init', function(room_id) {
//         Room.findOne({id: room_id}, function(err, doc) {
//             if (!err && doc) {
//                 var room = doc;

//                 // TODO: Need to figure out where to be setting this
//                 // room.sides[mySide] = socket;

//                 room.add(socket);
//                 room.markModified('sides');
//                 room.save();
//                 console.log("init room ***");
//                 console.log(room);
//             }
//         });
//         return;
//     });

//     // TODO: Get disconnections firing correctly
//     //
//     socket.on('disconnect', function() {
//         if(!room)
//             return;
//         room.remove(socket);
//         room.save();
//         room = undefined;
//     });

//     socket.on('chooseSide', function(args) {
//         var side = args.color;
//         var room_id = args.room_id;
//         var arbiter_token = args.arbiter_token;
//         var session;

//         console.log("chooseSide room_id: " + room_id);


//         Room.findOne({id: room_id}, function(err, room) {
//             if (!err && room) {
//                 if(!room.sides[side]) {
//                     mySide = side;

//                     if (arbiter_token) {
//                         room.arbiter_token_sides[side[0]] = arbiter_token;
//                     }

//                     console.log("CHOOSING SIDE");
//                     room.setSide(side, socket);
//                     room.markModified('sides');
//                     room.save();
//                     console.log(room);
//                     socket.emit('gotSide', side);
//                 }
//             }
//         });

//     });
//     socket.on('startGame', function() {
//         var i, l, side;
//         console.log("START GAME *****");

//         for(i=0, l = SIDES.length; i < l; ++i) {
//             side = SIDES[i];
//             if(room.sides[side] === socket) {
//                 room.starting[side] = true;
//                 room.broadcast('startPressed', side);
//                 break;
//             }
//         }

//         function startGame() {
//             room.board.startGame();
//         }

//         // start game if everyone has clicked start
//         if(_.size(room.starting) === SIDES.length) {
//             for(i=0, l = SIDES.length; i < l; ++i) {
//                 side = SIDES[i];
//                 setTimeout(startGame, config.START_WAIT_SECS*1000);
//                 room.sides[side].emit('starting', config.START_WAIT_SECS);
//             }
//             room.init();
//         }
//     });
//     socket.on('moveRequest', function(id, loc) {
//         room.board.moveRequest(id, loc, mySide);
//     });
// });

// app.get('/', function(req, res) {
//     // List open games for this user
//     Room.find({$or: [{white_session_id: req.session.id}, {black_session_id: req.session.id}]}, function(err, docs) {
//         console.log("docs ----");
//         console.log(docs);
//         return res.render('index', {
//             title: 'Bet BTC on Chess',
//             open_games: docs,
//             session_id: req.session.id
//         });
//     });
// });
