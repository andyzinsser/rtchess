var common = require('./common');
var Board = require('./board');

function RoomController(args) {
    this.room_id = args.room_id;
    this.board = args.board;
    this.boardView = args.boardView;
    this.socket = args.socket;
    // this.id = id;
    // this.sides = {};
    // this.starting = {};
    // this.watchers = [];
    // this.arbiter_id = undefined;
    // this.for_bitcoin = for_bitcoin;
    // this.arbiter_token_sides = {};
    // this.bought_in_arbiter_tokens = [];
    // var self = this;
}

// create board, bind events
RoomController.prototype.init = function() {

    // TODO: Need to get this firing

    console.log('roomController.init');
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
        // Payout the winner
        // TODO: Figure out the best place to set the arbiter ID
        if (self.model.arbiter_id) {
            request.post('https://cointoss.arbiter.me/api/v0.1/challenge/' + self.model.arbiter_id + '/payout/?winner_token=' + self.model.arbiter_token_sides[color],
                function(err, response, body) {
                    var parsed = JSON.parse(body);
                    args = {
                        amount: parsed.challenge.winner_paid_amount,
                        winner: color
                    };
                    self.io.sockets['in'](self.model.id).emit('arbiterPaid', args);
                    // self.broadcast('arbiterPaid', args);
                });
        }
    });

    this.board.on('activateBoard', function() {
        console.log('TODO: this.board.on activateBoard');
        // Once I get .broadcast working, repeat that signal sending pattern here

        // for(var i=0, l = SIDES.length; i < l; ++i) {
        //     var side = SIDES[i];
        //     if(self.sides[side])
        //         self.sides[side].emit('activateBoard');
        // }
    });

    this.board.on('disabled', function() {
        console.log("TODO: this.board.on disabled");
        // Once I get .broadcast working, repeat that signal sending pattern here

        // console.log('board disable');
        // for(var i=0, l = SIDES.length; i < l; ++i) {
        //     var side = SIDES[i];
        //     if(self.sides[side])
        //         self.sides[side].emit('disabled');
        // }
    });

    // add pieces TODO: send only 1 signal to client to add all pieces
    console.log("roomController.init self.board.addPieces");
    self.board.addPieces();
};

RoomController.prototype.broadcast = function() {
    // Broadcasts an event to all clients in the game room
    console.log(arguments);

    // TODO:
    // Not even sure if .broadcast is necessary. Just have the caller
    // signally directly to the server.
    // Then the server will broadcast to the room

    // for(var i=0, l = this.watchers.length; i < l; ++i) {
    //     var socket = this.watchers[i];
    //     socket.emit.apply(socket, arguments);
    // }
};

// RoomController.prototype.setSide = function(side, socket) {
//     for(var i=0, l = SIDES.length; i < l; ++i) {
//         var s = SIDES[i];
//         if(this.sides[s] === socket) {
//             delete this.sides[s];
//             delete this.starting[s];
//             this.broadcast('sideFree', s);
//         }
//     }
//     this.sides[side] = socket;
//     this.broadcast('sideTaken', side);
// };





// RoomController.prototype.add = function(socket) {
//     console.log('adding user');
//     this.watchers.push(socket);
// };

// RoomController.prototype.remove = function(socket) {
//     console.log('removing user');
//     var index = this.watchers.indexOf(socket);
//     if(index >= 0)
//         this.watchers.splice(index, 1);

//     for(var i=0, l = SIDES.length; i < l; ++i) {
//         var side = SIDES[i];
//         if(this.sides[side] === socket) {
//             delete this.sides[side];
//             delete this.starting[side];
//             this.broadcast('sideFree', side);
//             console.log(side, ' disconnected');

//             // if disconnect happened during a game
//             if(this.board && !this.board.disabled) {
//                 this.starting = {}; // no one is starting now
//                 this.board.disable();
//                 console.log(side, ' disconnected during game');
//                 this.broadcast('playerDisconnected', side);
//             }
//         }
//     }

//     // delete the room if no one is in it
//     if(this.watchers.length === 0) {
//         console.log('DELETING ROOM ' + this.id);
//         delete rooms[this.id];
//     }
// };

module.exports = RoomController;
