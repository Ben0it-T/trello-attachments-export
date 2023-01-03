/**
 * Chrome extension for Trello that allows to download all attachments on a Board
 * Two ways :
 *   - Download attachments
 *     - attachment filename > {card.idSort}-{attachment.fileName}
 *     - create and download cards list > 00-cards.json
 *   - Add dataURL (base64) to json export
 */


var $;
var base_url = "https://trello.com/1/";
var url = "";


/**
 * Function getBase64
 * Get file from url, convert file to base64 and return string
 *
 * Source: based on
 *  - https://stackoverflow.com/questions/36280818/how-to-convert-file-to-base64-in-javascript
 *  - https://stackoverflow.com/questions/72779435/base64-to-string-in-javascript
 * 
 * @param {url} url - file url
 * @return {string} - base64 string
 * 
 * @example
 * var url = 'https://example.com/file.png'
 * getBase64(url).then(
 *   data => console.log(data)
 * );
 */
function getBase64(url) {
    return fetch(url, { method: 'get', mode: 'no-cors', referrerPolicy: 'no-referrer' })
        .then(response => response.blob())
        .then(blob => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(blob);
        }));
}


/**
 * Function downloadFile
 * Get file from url and download it using File Blob
 *
 * Source: Download files using the File Blob
 *   - https://javascript.plainenglish.io/how-to-download-a-file-using-javascript-fec4685c0a22
 *   - https://gist.github.com/tiodot/4978b36aae431b79fa3ea9ba6800a90a
 * 
 * @param {url} url - file url
 * @param {string} fileName - file name
 */
function downloadFile(url, fileName) {
    fetch(url, { method: 'get', mode: 'no-cors', referrerPolicy: 'no-referrer' })
        .then(res => res.blob())
        .then(res => {
            const aElement = document.createElement('a');
            aElement.setAttribute('download', fileName);
            const href = URL.createObjectURL(res);
            aElement.href = href;
            aElement.setAttribute('target', '_blank');
            aElement.click();
            URL.revokeObjectURL(href);
        });
};


/**
 * Function downloadJsonData
 * Convert json input into a string and download it using File Blob
 *
 * @param {json} json_data
 * @param {string} fileName - file name
 */
function downloadJsonData(json_data, fileName) {
    var json_string = JSON.stringify(json_data, null, 2);
    var blob = new Blob([json_string], {type: 'text/plain'});
    const aElement = document.createElement('a');
    aElement.setAttribute('download', fileName);
    const href = URL.createObjectURL(blob);
    aElement.href = href;
    aElement.setAttribute('target', '_blank');
    aElement.click();
    URL.revokeObjectURL(href);
}


/**
 * Function downloadAttachments
 * Download all attachments on a Board using Trello API
 * 
 * Notes :
 * To use Trello API, we need the id of the board => Pattern: ^[0-9a-fA-F]{24}$
 * It seems to work with shortLink id (the one in url and in id-short-url elemt / a.js-export-json elemt) => Pattern: ^[0-9a-zA-Z]{8}$
 * But not referenced/documented
 * 
 * Get user boards (members/me/boards) > get current board > get id of the current board, then get cards on current board > download attachments
 */
function downloadAttachments() {
    var boardId = null;
    var boardUrl = document.location.href;
    var cardsData = [];

    // Notify user
    $.growl({
        title: "Download attachments",
        message: "Download in progress...<br/>This can take a while."
    });

    // Get boards
    //   - Fields: id,shortLink,url,shortUrl
    url = base_url + "members/me/boards?fields=id,shortLink,url,shortUrl";
    $.getJSON(url, function (boards) {
        // Get current board id
        // For each board in boards
        $.each(boards, function (key, board) {
            if (boardUrl == board.url) {
                boardId = board.id;
                return false; // breaks $.each loop
            }
        });

        if (boardId === null) {
            // Should never happen
            $.growl.error({
                title: "Download attachments",
                message: "Oops an error occurred !<br/>Can't retrieve current board id "
            });
            return;
        }

        // Get Cards on Board
        //   - Filter: all cards
        //   - Fields: id,name,idShort,url
        url = base_url + "boards/" + boardId + "/cards/all?fields=id,name,idShort,url";
        $.getJSON(url, function (cards) {
            // For each card in cards
            $.each(cards, function (key, card) {
                cardsData.push({
                    "id": card.id,
                    "name": card.name,
                    "idShort": card.idShort,
                    "url": card.url
                });
                // Get Card
                //   - Fields: id,name
                //   - Attachments: true
                //   - CheckItemStates: false
                url = base_url + "boards/" + boardId + "/cards/" + card.id + "?fields=id,name&attachments=true&checkItemStates=false";
                $.getJSON(url, function (data) {
                    if ('attachments' in data) {
                        if (data.attachments.length > 0) {
                            // For each attachment
                            $.each(data.attachments, function (key, attachment) {
                                // Check if attachment is a file
                                // When attachment is a link, it seems that :
                                //   - attachment.bytes: null
                                //   - attachment.isUpload: false
                                //   - attachment.mimeType: ""
                                //   - attachment.fileName: null
                                if (attachment.isUpload === true && attachment.mimeType !== '') {
                                    // Download attachment
                                    //console.log('file: ' + attachment.fileName);
                                    downloadFile(attachment.url, card.idShort+'-'+attachment.fileName);
                                }
                            });
                        }
                    }
                });
            });

            // Sort cardsData by idShort and download cardsData
            cardsData.sort((a,b) => a.idShort - b.idShort);
            downloadJsonData(cardsData, '00-cards.json');
        });
    })
    .fail(function() {
        $.growl.error({
            title: "Download attachments",
            message: "Oops an error occurred !"
        });
    });
}


/**
 * Function exportJsonWithAttachments
 * Export as JSON including attachments as dataURL in cards.attachments.file
 * 
 * Get json export > Foreach card, if there are attachments :
 * - add cards.attachments.file containing dataURL
 * - and remove cards.attachments.url
 * 
 * Note : this can take a while... according to the number of attachments and/or attachments size
 */
function exportJsonWithAttachments() {
    // Get json export url
    var boardExportUrl = $('a.js-export-json').attr('href');

    // Check export link => /b/{shortLink}.json
    const exportUrlRegex = /\/b\/([0-9a-zA-Z]{8})\.json/;
    if (exportUrlRegex.exec(boardExportUrl) === null) {
        // get if from board url => https://trello.com/b/{shortLink}/board-name
        var boardUrl = document.location.href;
        boardExportUrl = boardUrl.substring(0, boardUrl.lastIndexOf("/") ) + '.json';
    }
    
    const promises = []; // see notes below
    
    // Notify user
    $.growl({
        title: "Export as JSON",
        message: "Export in progress...<br/>This can take a while."
    });

    // Get json export
    $.getJSON(boardExportUrl, function (data) {
        var exportFilename = data.shortLink + '-inclAtt.json';

        // Foreach card
        $.each(data.cards, function (i, card) {
            if ('attachments' in card) {
                if (card.attachments.length > 0) {
                    // For each attachment
                    $.each(card.attachments, function (j, attachment) {
                        // Check if attachment is a file
                        // When attachment is a link, it seems that :
                        //   - attachment.bytes: null
                        //   - attachment.isUpload: false
                        //   - attachment.mimeType: ""
                        //   - attachment.fileName: null
                        if (attachment.isUpload === true && attachment.mimeType !== '') {
                            // Encode attachment to base64 (dataUrl) and add it to json
                            
                            // getBase64(attachment.url).then(dataUrl => {
                            //     // keep only base64 stuff : ex. data:image/png;base64,base64stuff
                            //     arr = dataUrl.split(',');
                            //     // push base64 attachment as attachment.file
                            //     data.cards[i].attachments[j].file = arr[1];
                            //     // remove attachment.url
                            //     delete data.cards[i].attachments[j].url;
                            // });

                            // Use promises and wait until all promises complete (Promise.all|Promise.allSettled)
                            
                            promises.push(
                                getBase64(attachment.url).then(dataUrl => {
                                    console.log('att: ' + attachment.name)
                                    // keep only base64 stuff : ex. data:image/png;base64,base64stuff
                                    arr = dataUrl.split(',');
                                    // push base64 attachment as attachment.file
                                    data.cards[i].attachments[j].file = arr[1];
                                    // remove attachment.url
                                    delete data.cards[i].attachments[j].url;
                                })
                            );
                        }
                    });
                }
            }
        });

        // Export json as board.shortLink-inclAtt.json

        // setTimeout(function(){
        //     downloadJsonData(data, exportFilename);
        // }, 500);

        // See notes a above. Wait until all promises complete
        const runningJobs = function () {
            console.log('Jobs Start');
            return Promise.all(promises);
            //return Promise.allSettled(promises);
        }

        runningJobs().then(() => {
            console.log('Jobs done');

            // Notify user
            $.growl.notice({
                title: "Export as JSON",
                message: "Done. Downloading JSON file"
            });

            // Download data
            downloadJsonData(data, exportFilename);

        }).catch(err => {
            // Notify user
            $.growl.error({
                title: "Export as JSON",
                message: "Oops an error occurred !"
            });
            console.log(err);
        });
    })
    .fail(function() {
        $.growl.error({
            title: "Export as JSON",
            message: "Oops an error occurred !<br/>Fail to retrieve json export."
        });
    });
}


/**
 * Function addExportLink
 * Add 'Download All Attachments' and 'Export JSON including Attachments' link/button to 'Print and export' menu to the DOM
 * Based on:
 * - https://github.com/trapias/TrelloExport
 * - https://github.com/Q42/TrelloScrum
 */
function addExportLink() {

    var $js_btn = $('a.js-export-json'); // Export JSON link

    // If 'Download All Attachments' link/button already exists
    if ($('.pop-over-list').find('.js-download-attachments').length) {
        return;
    }

    // Create links/buttons
    if ($js_btn.length) {
        // 'Download All Attachments' link/button
        $download_attachments_btn = $('<a>')
            .attr({
                'class': 'js-download-attachments',
                'href': '#',
                'target': '_blank',
                'title': 'Download All Attachments'
            })
            .text('Download All Attachments')
            .click(downloadAttachments)
            .insertAfter($js_btn.parent())
            .wrap(document.createElement("li"));

        // 'Export JSON including Attachments' link/button
        $export_attachments_btn = $('<a>')
            .attr({
                'class': 'js-export-attachments',
                'href': '#',
                'target': '_blank',
                'title': 'Export the board data in JSON format including Attachments'
            })
            .text('Export as JSON including Attachments')
            .click(exportJsonWithAttachments)
            .insertAfter($js_btn.parent())
            .wrap(document.createElement("li"));
    }
}


// on DOM load
$(function () {
    // See https://github.com/Q42/TrelloScrum
    // Look for clicks on the .js-share class, which is
    // the "Print and export" link on the board header option list
    $(document).on('mouseup', '.js-share', function () {
        setTimeout(addExportLink, 500);
    });
});
