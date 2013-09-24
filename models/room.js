var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    common = require('../lib/common'),
    SIDES = ['black', 'white'];

var gameSchema = new Schema({
    id: {'type': String, 'unique': true},
    date_created: {'type': Date, 'default': Date.now()},
    connected_players: {'type':Number, 'default': 0},
    players_clicked_start: {'type':Number, 'default': 0},
    white_session_id: String,
    black_session_id: String,
    arbiter_id: String,
    for_bitcoin: {'type': Boolean, 'default': false},
    arbiter_token_sides: Schema.Types.Mixed,
    bought_in_arbiter_tokens: []
});

gameSchema.methods.allPlayersConnected = function() {
    return (this.connected_players >= 2);
};

gameSchema.methods.allPlayersPressedStart = function() {
    return (this.players_clicked_start >= 2);
};

// gameSchema.methods.add = function(socket) {
//     this.watchers.push(socket);
//     for(var i=0, l = SIDES.length; i < l; ++i) {
//         var side = SIDES[i];
//         if(this.sides[side])
//             socket.emit('sideTaken', side);
//         if(this.starting[side])
//             socket.emit('startPressed', side);
//     }
// };

// gameSchema.methods.remove = function(socket) {
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
//     this.markModified('sides');
//     this.markModified('starting');
// };

// gameSchema.methods.setSide = function(side, socket) {
//     for(var i=0, l = SIDES.length; i < l; ++i) {
//         var s = SIDES[i];
//         if(this.sides[s] === socket) {
//             delete this.sides[s];
//             delete this.starting[s];
//             // this.broadcast('sideFree', s);
//         }
//     }
//     this.sides[side] = socket;
//     // this.broadcast('sideTaken', side);
// };

module.exports = mongoose.model('Game', gameSchema);
