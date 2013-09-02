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

var Board = require('./lib/board');
var config = require('./lib/config');
var common = require('./lib/common');

var logger = console;

// var app = express.createServer();
var express = require("express");
var app = express();
var http = require('http');
var server = http.createServer(app);
var io = require('socket.io').listen(server);

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


function Room(id, for_bitcoin) {
    this.id = id;
    this.sides = {};
    this.starting = {};
    this.watchers = [];
    this.arbiter_id = undefined;
    this.for_bitcoin = for_bitcoin;
    this.arbiter_token_sides = {};
    var self = this;
}

// create board, bind events
Room.prototype.init = function() {
    var self = this;
    this.board = new Board();

    var events = ['addPiece', 'removePiece', 'movePiece', 'movedPiece', 'immobilePiece', 'mobilePiece', 'gameOver'];

    var broadcast = {
        emit: function() {
                  self.broadcast.apply(self, arguments);
              }
    };
    common.bindPassThrough(events, broadcast, this.board);

    this.board.on('gameOver', function(color) {
        // no one is starting
        self.starting = {};

        // Payout the winner
        if (self.arbiter_id) {
            request.post('https://cointoss.arbiter.me/api/v0.1/challenge/' + self.arbiter_id + '/payout/?winner_token=' + self.arbiter_token_sides[color],
                function(err, response, body) {
                    var parsed = JSON.parse(body);
                    console.log(parsed);
                });
        }
    });

    this.board.on('activateBoard', function() {
        console.log('board activate');
        for(var i=0, l = SIDES.length; i < l; ++i) {
            var side = SIDES[i];
            if(self.sides[side])
                self.sides[side].emit('activateBoard');
        }
    });
    this.board.on('disabled', function() {
        console.log('board disable');
        for(var i=0, l = SIDES.length; i < l; ++i) {
            var side = SIDES[i];
            if(self.sides[side])
                self.sides[side].emit('disabled');
        }
    });

    // add pieces TODO: send only 1 signal to client to add all pieces
    self.board.addPieces();
};

Room.prototype.broadcast = function() {
    console.log('broadcast to #:', this.watchers.length);
    for(var i=0, l = this.watchers.length; i < l; ++i) {
        var socket = this.watchers[i];
        socket.emit.apply(socket, arguments);
    }
};

Room.prototype.setSide = function(side, socket) {
    for(var i=0, l = SIDES.length; i < l; ++i) {
        var s = SIDES[i];
        if(this.sides[s] === socket) {
            delete this.sides[s];
            delete this.starting[s];
            this.broadcast('sideFree', s);
        }
    }
    this.sides[side] = socket;
    this.broadcast('sideTaken', side);
};

Room.prototype.add = function(socket) {
    console.log('adding user');
    this.watchers.push(socket);
};

Room.prototype.remove = function(socket) {
    console.log('removing user');
    var index = this.watchers.indexOf(socket);
    if(index >= 0)
        this.watchers.splice(index, 1);

    for(var i=0, l = SIDES.length; i < l; ++i) {
        var side = SIDES[i];
        if(this.sides[side] === socket) {
            delete this.sides[side];
            delete this.starting[side];
            this.broadcast('sideFree', side);
            console.log(side, ' disconnected');

            // if disconnect happened during a game
            if(this.board && !this.board.disabled) {
                this.starting = {}; // no one is starting now
                this.board.disable();
                console.log(side, ' disconnected during game');
                this.broadcast('playerDisconnected', side);
            }
        }
    }

    // delete the room if no one is in it
    if(this.watchers.length === 0) {
        console.log('DELETING ROOM ' + this.id);
        delete rooms[this.id];
    }
};

function Session(token, private_key) {
    this.token = token;
    this.private_key = private_key;
    this.side_for_rooms = {};
}

var rooms = {};
var SIDES = ['black', 'white'];
var sessions = {};

io.configure(function() {
    io.set('transports', ['xhr-polling']);
    // io.set('transports', ['jsonp-polling']);
    io.set("polling duration", 10);
});

io.sockets.on('connection', function(socket) {
    var room;
    var mySide;
    socket.on('ping', function() {
        socket.emit('pong');
    });
    socket.on('init', function(room_id) {
        console.log('got init', room_id);
        // don't allow multiple room_ids to be sent
        if(room)
            return;

        room = rooms[room_id];
        if(!room) {
            room = new Room(room_id);
            rooms[room_id] = room;
        }

        room.add(socket);

        for(var i=0, l = SIDES.length; i < l; ++i) {
            var side = SIDES[i];
            if(room.sides[side])
                socket.emit('sideTaken', side);
            if(room.starting[side])
                socket.emit('startPressed', side);
        }
    });
    socket.on('disconnect', function() {
        if(!room)
            return;
        room.remove(socket);
        room = undefined;
    });
    socket.on('chooseSide', function(args) {
        var side = args.color;
        var arbiter_token = args.arbiter_token;
        var session;

        if(!room)
            return;
        if(!room.sides[side]) {
            mySide = side;

            if (arbiter_token) {
                room.arbiter_token_sides[side[0]] = arbiter_token;
            }

            room.setSide(side, socket);
            socket.emit('gotSide', side);
        }
    });
    socket.on('startGame', function() {
        var i, l, side;

        for(i=0, l = SIDES.length; i < l; ++i) {
            side = SIDES[i];
            if(room.sides[side] === socket) {
                room.starting[side] = true;
                room.broadcast('startPressed', side);
                break;
            }
        }

        function startGame() {
            room.board.startGame();
        }

        // start game if everyone has clicked start
        console.log(room.starting);
        if(_.size(room.starting) === SIDES.length) {
            for(i=0, l = SIDES.length; i < l; ++i) {
                side = SIDES[i];
                setTimeout(startGame, config.START_WAIT_SECS*1000);
                room.sides[side].emit('starting', config.START_WAIT_SECS);
            }
            room.init();
        }
    });
    socket.on('moveRequest', function(id, loc) {
        room.board.moveRequest(id, loc, mySide);
    });
});

app.get('/', function(req, res) {
    return res.render('index', {
        title: 'Bet BTC on Chess'
    });
});

app.get('/about', function(req, res) {
    return res.render('about', {
        title: 'Bullet Chess'
    });
});

app.get('/new_room', function(req, res) {
    var room_id = randomString(10);
    var for_bitcoin = parseBool(req.query.for_bitcoin);
    rooms[room_id] = new Room(room_id, for_bitcoin);
    return res.redirect('/r/' + room_id);
});

app.get('/join_random', function(req, res) {
    var roomList = [];
    var id, room;
    var for_bitcoin = parseBool(req.query.for_bitcoin);
    var oneLeft = SIDES.length - 1;

    // find rooms with 1 side left to fill and everyone else has hit start
    for(id in rooms) {
        room = rooms[id];
        if(_.size(room.sides) === oneLeft && _.size(room.starting) === oneLeft) {
            console.log("1 SIDE LEFT + HIT START");
            console.log("for_bitcoin: " + for_bitcoin);
            console.log("room.for_bitcoin: " + room.for_bitcoin);
            console.log(for_bitcoin === room.for_bitcoin);
            if (for_bitcoin === room.for_bitcoin) {
                roomList.push(rooms[id]);
            }
        }
    }

    // find rooms with 1 side left to fill
    if(!roomList.length) {
        for(id in rooms) {
            room = rooms[id];
            if(_.size(room.sides) === oneLeft) {
                console.log("ROOM WITH 1 SIDE LEFT TO FILL");
                console.log("for_bitcoin: " + for_bitcoin);
                console.log("room.for_bitcoin: " + room.for_bitcoin);
                console.log(for_bitcoin === room.for_bitcoin);
                if (for_bitcoin === room.for_bitcoin) {
                    roomList.push(rooms[id]);
                }
            }
        }
    }

    // find rooms with someone in them
    if(!roomList.length) {
        for(id in rooms) {
            room = rooms[id];
            if(_.size(room.watchers) > 0 && _.size(room.sides) !== SIDES.length) {
                console.log("ROOM WITH SOMEONE IN THEM");
                console.log("for_bitcoin: " + for_bitcoin);
                console.log("room.for_bitcoin: " + room.for_bitcoin);
                console.log(for_bitcoin === room.for_bitcoin);
                if (for_bitcoin === room.for_bitcoin) {
                    roomList.push(rooms[id]);
                }
            }
        }
    }

    // create a new room
    if(!roomList.length) {
        return res.redirect('/new_room?for_bitcoin=' + for_bitcoin);
    }

    var i = Math.floor(Math.random()*roomList.length);
    room = roomList[i];
    return res.redirect('/r/' + room.id);
});

app.get('/r/:room_id', function(req, res) {
    var room_id = req.param('room_id');
    var room = rooms[room_id];

    if(!rooms[room_id]) {
        // TODO: Not sure when this get hit in the flow
        //       need to figure out how to determine if this game is intended to be fore bitcoin or not
        console.log("CREATING A NEW ROOM IN /r/:room_id");
        console.log("TODO: Figure out how to check if this is for bitcoin or not");
        rooms[room_id] = new Room(room_id, false);
        room = rooms[room_id];
    }

    var buyIntoRoom = function(arbiter_token, room, next) {
        var private_key = sessions[arbiter_token].private_key;
        request.post('https://cointoss.arbiter.me/api/v0.1/challenge/' + room.arbiter_id + '/ante/?arbiter_token=' + arbiter_token + '&arbiter_private_key=' + private_key,
            function(err, response, body) {
                var parsed = JSON.parse(body);
                console.log(parsed);
                if (parsed.auth_url) {
                    return res.render('room', {
                        title: 'Authenticate with Arbiter',
                        room_id: room_id,
                        auth_url: parsed.auth_url
                    });
                } else {
                    next(parsed.success);
                }
            }
        );

    };

    if (room.for_bitcoin === true) {
        // Make sure we have an arbiter challenge setup for this game
        if (!room.arbiter_id) {
            request.post('https://cointoss.arbiter.me/api/v0.1/challenge/create/?ante=0.001&' +
                         'return_address=1PkBgbVetZGjNMrkLMdzh7kc3eNJooStb4&developer_take=0.0',
                        function(err, response, body) {
                            var parsed = JSON.parse(body);
                            if (parsed.success) {
                                room.arbiter_id = parsed.challenge._id;
                                if (req.session.arbiter_token) {
                                    buyIntoRoom(req.session.arbiter_token, room, function(success) {

                                        // TODO: include the pot amount in the page somewhere
                                        if (success) {
                                            return res.render('room', {
                                                title: 'Real-Time Chess: Game',
                                                room_id: room_id,
                                                arbiter_id: room.arbiter_id,
                                                arbiter_token: req.session.arbiter_token
                                            });
                                        }
                                        else {
                                            return res.render('error', {
                                                title: "Sorry",
                                                error: "Couldn't buy into the game."
                                            });
                                        }
                                    });
                                }
                            }
                            else {
                                return res.render('error', {
                                    title: "Sorry",
                                    error: "Arbiter is down, so wagering bitcoin is temporarily disabled."
                                });
                            }
                        });
        }

        // Make sure the user is authenticated on arbiter
        if (req.session.arbiter_token) {
            buyIntoRoom(req.session.arbiter_token, room, function(success) {
                // TODO: include the pot amount in the page somewhere
                if (success) {
                    return res.render('room', {
                        title: 'Real-Time Chess: Game',
                        room_id: room_id,
                        arbiter_id: room.arbiter_id,
                        arbiter_token: req.session.arbiter_token
                    });
                }
                else {
                    return res.render('error', {
                        title: "Sorry",
                        error: "Couldn't buy into the game."
                    });
                }
            });
        }
        else {
            request.post('https://cointoss.arbiter.me/api/v0.1/token/create/', function(err, response, body) {
                var parsed = JSON.parse(body);
                if (parsed.token) {
                    req.session.arbiter_token = parsed.token;
                    sessions[parsed.token] = new Session(parsed.token, parsed.private_key);

                    if (room.arbiter_id) {
                        // TODO: include the pot amount in the page somewhere
                        buyIntoRoom(parsed.token, room, function(success) {
                            if (success) {
                                return res.render('room', {
                                    title: 'Real-Time Chess: Game',
                                    room_id: room_id,
                                    arbiter_id: room.arbiter_id,
                                    arbiter_token: req.session.arbiter_token
                                });
                            }
                            else {
                                return res.render('error', {
                                    title: "Sorry",
                                    error: "Couldn't buy into the game."
                                });
                            }
                        });
                    }

                } else {
                    return res.render('error', {
                        title: "Sorry",
                        error: "Arbiter is down, so wagering bitcoin is temporarily disabled."
                    });
                }
            });
        }
    }
    else {
        console.log("JUST LOAD THE ROOM");
        return res.render('room', {
            title: 'Real-Time Chess: Game',
            room_id: room_id
        });
    }
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

function randomString(len) {
    var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz';
    var ret = '';
    for (var i=0; i<len; i++) {
        var rnum = Math.floor(Math.random() * chars.length);
        ret += chars.substring(rnum,rnum+1);
    }
    return ret;
}

function parseBool(str) {
    return (str == "true") ? true : false;
}

var port = process.env.PORT || 5000;

server.listen(port, function() {
    logger.info('server running on port ' + port);
});
