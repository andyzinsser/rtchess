(function(window){

// add dummy console.log for IE (TODO: remove)
if(!window.console) {
    window.console = {
        log: function() {}
    };
}

var RoomController = require('./room');
var view = require('./view');
var common = require('./common');
var config = require('./config');

// TODO: Figure out why requiring the template wasn't working
var for_bitcoin_switch_html = '' +
    '<div class="btn-group" id="for_bitcoin_selection">' +
    '   <a class="for-bitcoin-selection btn btn-success btn-large btn-home" data-for-bitcoin="true">Bet <i class="icon icon-btc"></i>0.001</a>' +
    '   <a class="for-bitcoin-selection btn btn-primary btn-large btn-home">Just Play</a>' +
    '</div>';


window.initSetupButtons = function() {
    // var join_random,
    var $targetBtn,
        target_previous_html,
        $resetBtn = $('#reset_btn');
        $allButtons = $("#index_content").find('.btn');


    var resetButtons = function() {
        $("#for_bitcoin_selection").replaceWith($targetBtn);
        $resetBtn.addClass('hide');
        $allButtons.fadeIn('fast');
    };

    var swapForBitcoinSelection = function() {
        $allButtons.fadeOut(10);
        $targetBtn.replaceWith(for_bitcoin_switch_html);
        $resetBtn.removeClass('hide');
    };


    $("#index_content").on('click', '#new_game', function(evt) {
        $targetBtn = $(evt.target);
        // join_random = $targetBtn.data('join-random') || false;
        swapForBitcoinSelection();
        mixpanel.track('index.clicked-new-game');
    });

    $("#index_content").on('click', '.for-bitcoin-selection', function(evt) {
        var $target = $(evt.target);
        var for_bitcoin = false;

        if ($target.hasClass('icon')) {
            $target = $(evt.target).parent();
        }

        for_bitcoin = $target.data('forBitcoin');

        mixpanel.track('index.clicked-bitcoin-selection-' + for_bitcoin);
        window.location = "/new_room?for_bitcoin=" + for_bitcoin;

        // if (join_random) {
        //     window.location = "/join_random?for_bitcoin=" + for_bitcoin;
        // } else {
        //     window.location = "/new_room?for_bitcoin=" + for_bitcoin;
        // }
    });

    $resetBtn.click(resetButtons);
};


window.startRoom = function(args) {
    var room_id = args.room_id,
        arbiter_token = args.arbiter_token,
        mySide = args.mySide[0], // Only need the first letter
        SIDES = ['black', 'white'],
        socket = io.connect();

    var runPing = function() {
        var from = (new Date()).getTime();
        socket.emit('ping');
        socket.once('pong', function() {
            var to = (new Date()).getTime();
            $('#ping').text(to - from);
        });
    };
    var pingId = setInterval(runPing, config.PING_PERIOD*1000);

    var start = function() {
        console.log("client.startRoom.start");
        view.unbindEvents(socket);
        console.log("client.startRoom.start new BoardView");
        var roomController = new RoomController({
            room_id: room_id,
            boardView: new view.BoardView(mySide),
            socket: socket
        });

        // var boardView = new view.BoardView(mySide);

        // This should be getting called before the boardView intializes
        view.bindEvents(socket, roomController.boardView);

        // TODO: This could probably move into roomController.init
        //       Just need to be sure we have access to the socket within roomController
        roomController.boardView.on('moveRequest', function(id, loc) {
            console.log("client.startRoom.start.boardView.on moveRequest");
            socket.emit('moveRequest', id, loc);
        });

        roomController.init();
        roomController.boardView.draw();

        mixpanel.track('room.game-started');
    };

    socket.on('connect', function() {
        socket.emit('init', room_id);
        $('#disconnect-message').remove();
        runPing();
    });

    socket.on('starting', function(secs) {
        start();
        $(".button-bar").remove();
        $('.message').remove();
        $('#chess-board').append('<div class="message" id="starting-message">Game starting in <span id="starting-secs"></span> seconds</div>');
        secs -= 0; // convert to number
        function countDown() {
            if(secs === 0) {
                $('#starting-message').remove();
                clearInterval(countdownId);
                return;
            }
            $('#starting-secs').text(secs);
            secs -= 1;
        }
        countDown();
        var countdownId = setInterval(countDown, 1000);
    });


    // Click handlers
    //
    $('#start-game').click(function() {
        $('#start-game').attr('disabled', 'disabled');
        socket.emit('playerClickedStart', room_id);
        $('.message').remove();

        $('#chess-board').append('' +
            '<div class="message" id="wait-message">' +
            '   <h3>Waiting for opponent to press start...</h3>' +
            '   <p>Invite a friend to play:<br>' +
            '   '+window.location.href+'</p>' +
            '</div>');
        mixpanel.track('room.clicked-start-game');
    });

    socket.on('disconnect', function() {
        $('#chess-board').append('<div class="message" id="disconnect-message">You are disconnected. If you do not reconnect automatically, try refreshing the page.</div>');
        clearInterval(pingId);
    });


    // socket.on('playerDisconnected', function(color) {
    //     var prettyColor = common.letter2color(color);
    //     $('.message').remove();
    //     $('#chess-board').append('<div class="message" id="disconnect-message">' + prettyColor + ' was disconnected!</div>');
    //     $('#start-game').removeAttr('disabled');
    //     mixpanel.track('room.player-disconnected');
    // });
    socket.on('gameOver', function(winner) {
        var color = common.letter2color(winner);
        var $cb = $('#chess-board');
        $cb.append('<div class="message">Game over! ' + color + ' wins!</div>');
        $('#start-game').removeAttr('disabled');
        mixpanel.track('room.game-over');
    });
    socket.on('arbiterPaid', function(args) {
        var $modal = $("#payout_modal");
        $modal.find('#winner').html(common.letter2color(args.winner));
        $modal.find('#amount').html(args.amount);
        $modal.modal('show');
        mixpanel.track('room.arbiter-paid');
    });

    // var boardView;

    // socket.emit('chooseSide', {color: mySide, arbiter_token: arbiter_token, room_id: room_id});
};

window.buyIn = function(auth_url) {
    var openAuthWindow = function() {
        mixpanel.track('room.clicked-buy-in');
        var authWindow = window.open(auth_url + '&app_name=Bullet Chess&redirect_url=' + window.location.href,
                         '', 'left=100,width=400,height=600,menubar=no,resizable=no,scrollbars=no,titlebar=no,top=100');
    };

    $("#open_auth_window").click(openAuthWindow);
};


})(window);
