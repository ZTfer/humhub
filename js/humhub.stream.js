/**
 * Core module for managing Streams and StreamItems
 * @type Function
 */
humhub.initModule('stream', function (module, require, $) {

    var util = require('util');
    var object = util.object;
    var string = util.string;
    var client = require('client');
    var Content = require('content').Content;

    var STREAM_INIT_COUNT = 8;
    var STREAM_LOAD_COUNT = 4;

    //TODO: load streamUrl from config
    //TODO: readonly

    /**
     * Base class for all StreamContent
     * @param {type} id
     * @returns {undefined}
     */
    var StreamEntry = function (id) {
        this.$ = object.isString(id) ? this.$ = $('#' + id) : id;
        Content.call(this);
    };
    
    object.inherits(StreamEntry, Content);
    
    StreamEntry.prototype.getContentActions = function() {
        return ['delete', 'edit'];
    };
    
    StreamEntry.prototype.delete = function () {
        var content = this.getContentInstance();
        if(content && content.delete) {
            //TODO: modalconfirm
            content.delete();
        } else {
            StreamEntry._super.delete.call(this);
        }
    };
    
    StreamEntry.prototype.reload = function () {
        getStream().reload(this);
    };

    StreamEntry.prototype.edit = function () {
        //Search for data-content-edit-url on root.
        //Call this url with data-content-pk
        //Trigger delete event
    };

    StreamEntry.prototype.getContentInstance = function () {
        return Content.getInstance(this.$.find('[data-content-base]'));
    };
    
    /**
     * Stream implementation.
     * 
     * @param {type} container id or jQuery object of the stream container
     * @returns {undefined}
     */
    var Stream = function (container) {
        this.$ = (object.isString(container)) ? $('#' + container) : container;
        
        if (!this.$.length) {
            return;
        }
        
        //If a contentId is set on the stream root we will only show the single content
        if(this.$.data('stream-contentid')) {
            this.contentId = parseInt(this.$.data('stream-contentid'));
        }
        
        this.$stream = this.$.find(".s2_stream");
        
        //Cache some stream relevant data/nodes
        this.url = this.$.data('stream'); //TODO: set this in config instead of data field
        this.$loader = this.$stream.find(".streamLoader");
        this.$content = this.$stream.find('.s2_streamContent');
        this.$filter = $('.wallFilterPanel');

        //TODO: make this configurable
        this.filters = [];
        this.sort = "c";
        
        Content.call(this);
    };
    
    object.inherits(Stream, Content);
    
    Stream.prototype.getContentActions = function() {
        return [];
    };
    
    /**
     * Initializes the stream, by clearing the stream and reloading initial stream entries,
     * this should be called if any filter/sort settings are changed or the stream
     * needs an reload.
     * 
     * @returns {humhub.stream_L5.Stream.prototype}
     */
    Stream.prototype.init = function () {
        this.clear();
        this.$stream.show();
        if (this.isShowSingleEntry()) {
            this.loadSingleEntry(this.contentId);
        } else {
            this.loadEntries(STREAM_INIT_COUNT);
        }
        return this;
    };
    
    Stream.prototype.clear = function() {
        this.lastEntryLoaded = false;	
        this.readOnly = false;
        this.loading = false;
        this.$.find(".s2_streamContent").empty();
        this.$.find(".s2_stream").hide();
        this.$.find(".s2_single").hide();
        this.$.find(".streamLoader").hide();
        this.$.find(".emptyStreamMessage").hide();
        this.$.find(".emptyFilterStreamMessage").hide();
        this.$.find('.back_button_holder').hide();
        this.$filter.hide();
    };

    Stream.prototype.loadSingleEntry = function(contentId) {
        this.$.find('.back_button_holder').show();
        this.loadEntries(1, (contentId + 1), '');
    };
    
    Stream.prototype.reloadEntry = function(entry) {
        var that = this;
        return new Promise(function(resolve, reject) {
           entry = (entry instanceof StreamEntry) ? entry : that.getEntry(entry);
        
            if(!entry) {
                console.warn('Attempt to reload of non existent entry: '+entry);
                reject();
                return;
            }

            var contentId = entry.getKey();
            return that._load(1, (contentId + 1), '').then(function(response) {
                  if(response.content[contentId]) {
                      entry.replaceContent(response.content[contentId].output);
                      resolve(entry);
                  } else {
                      console.warn('Reload failed: ContentId not found in response: '+contentId);
                      reject();
                  }
            }, reject); 
        });
           };

    Stream.prototype.loadEntries = function (limit, from, filter, sort) {
        if (this.loading || this.lastEntryLoaded) {
            return;
        }

        //Initialize loading process
        this.$loader.show();
        this.loading = true;

        //Overwrite the stream settings if provided
        limit   = limit || STREAM_LOAD_COUNT;
        from    = from  || this.getLastContentId();
        filter  = filter || this.getFilterString();
        sort    = sort  || this.sort;
        
        var that = this;
        return new Promise(function(resolve, reject) {
            that._load(limit, from, filter,sort).then(function(response) {
                that.$loader.hide();
                if (object.isEmpty(response.content)) {
                    that.lastEntryLoaded = true;
                    $('#btn-load-more').hide();
                } else {
                    that.lastEntryLoaded = response.is_last;
                    that.appendEntries(response);
                }
                
                that.loading = false;
                that.onChange();
                resolve();
            }).catch(function(err) {
                //TODO: handle error
                that.loading = false;
                that.$loader.hide();
                reject();
            });
        });
    };
    
    Stream.prototype._load = function (limit, from, filter, sort) {
        return client.ajax(this.url, {
            data: {
                filters: filter,
                sort: sort,
                from: from,
                limit: limit
            }
        });
    };

    Stream.prototype.getLastContentId = function () {
        var $lastEntry = this.$stream.find('[data-content-pk]').last();
        if ($lastEntry.length) {
            return $lastEntry.data('stream-contentid');
        }
    };

    Stream.prototype.appendEntries = function (response) {
        var that = this;
        var result = '';
        $.each(response.contentIds, function (i, key) {
            var $entry = that.$.find('[data-content-pk="' + key + '"]');
            if ($entry.length) {
                $entry.remove();
            }
            result += response.content[key].output;
        });
        return this.$content.append(result);
    };

    /**
     * Fired when new entries are shown
     */
    Stream.prototype.onChange = function () {
        if (this.readOnly) {
            $('.wallReadOnlyHide').hide();
            $('.wallReadOnlyShow').show();
        } else {
            $('.wallReadOnlyShow').hide();
        }

        var hasEntries = this.hasEntries();
        if (!hasEntries && !this.hasFilter()) {
            this.$.find('.emptyStreamMessage').show();
            this.$filter.hide();
        } else if (!hasEntries) {
            this.$.find('.emptyFilterStreamMessage').hide();
        } else if(!this.isShowSingleEntry()) {
            this.$filter.show();
            this.$.find('.emptyStreamMessage').hide();
            this.$.find('.emptyFilterStreamMessage').hide();
        }

        //TODO: fire global event
    };
    
    Stream.prototype.isShowSingleEntry = function () {
        return object.isDefined(this.contentId);
    };

    Stream.prototype.hasEntries = function () {
        return this.getEntryCount() > 0;
    };

    Stream.prototype.getEntryCount = function () {
        return this.$.find('[data-content-pk]').length;
    };
    
    Stream.prototype.hasFilter = function () {
        return this.filters.length > 0;
    };
    
    Stream.prototype.getFilterString = function () {
        var result = '';
        $.each(this.filters, function(i, filter) {
            result += filter+',';
        });
        
        return string.cutsuffix(result, ',');
    };
    
    Stream.prototype.setFilter = function (filterId) {
        if(this.filters.indexOf(filterId) < 0) {
            this.filters.push(filterId);
        }
    };
    
    Stream.prototype.unsetFilter = function (filterId) {
        var index = this.filters.indexOf(filterId);
        if(index > -1) {
            this.filters.splice(index, 1);
        }
    };

    Stream.prototype.getEntry = function(key) {
        return new StreamEntry(this.$.find('[data-content-pk="' + key + '"]'));
    };
    
    Stream.prototype.getEntryByNode = function($childNode) {
        return new StreamEntry($childNode.closest('[data-content-pk]'));
    };

    var getStream = function () {
        if (!module.instance) {
            var $stream = $('[data-stream]').first();
            module.instance = $stream.length ? new Stream($stream) : undefined;
        }
        return module.instance;
    };

    var getEntry = function (id) {
        return module.getStream().getEntry(id);
    };

    var init = function () {
        var stream = getStream();
        
        if(!stream) {
            console.log('Non-Stream Page!');
            return;
        } 
        
        stream.init();
        
        $(window).scroll(function () {
            if ($(window).scrollTop() == $(document).height() - $(window).height()) {
                if (stream && !stream.loading && !stream.isShowSingleEntry() && !stream.lastEntryLoaded) {
                    stream.loadEntries();
                }
            }
        });
        
        stream.$.on('click', '.singleBackLink', function() {
            stream.contentId = undefined;
            stream.init();
            $(this).hide();
        });
        
        initFilterNav();
    };

    var initFilterNav = function() {
        $(".wallFilter").click(function () {
            var $filter = $(this);
            var checkboxi = $filter.children("i");
            checkboxi.toggleClass('fa-square-o').toggleClass('fa-check-square-o');
            if(checkboxi.hasClass('fa-check-square-o')) {
                getStream().setFilter($filter.attr('id').replace('filter_', ''));
            } else {
                getStream().unsetFilter($filter.attr('id').replace('filter_', ''));
            }
            getStream().init();
        });

        $(".wallSorting").click(function () {
            var newSortingMode = $(this).attr('id');

            // uncheck all sorting
            $(".wallSorting").find('i')
                    .removeClass('fa-check-square-o')
                    .addClass('fa-square-o');

            // check current sorting mode
            $("#" + newSortingMode).children("i")
                    .removeClass('fa-square-o')
                    .addClass('fa-check-square-o');

            // remove sorting id append
            newSortingMode = newSortingMode.replace('sorting_', '');

            // Switch sorting mode and reload stream
            getStream().sort = newSortingMode;
            getStream().init();
        });
    };

    module.export({
        StreamEntry: StreamEntry,
        Stream: Stream,
        getStream: getStream,
        getEntry: getEntry,
        init: init
    });
});

/* TODO:
 Stream.prototype.wallStick = function (url) {
 $.ajax({
 dataType: "json",
 type: 'post',
 url: url
 }).done(function (data) {
 if (data.success) {
 if (currentStream) {
 $.each(data.wallEntryIds, function (k, wallEntryId) {
 currentStream.deleteEntry(wallEntryId);
 currentStream.prependEntry(wallEntryId);
 });
 $('html, body').animate({scrollTop: 0}, 'slow');
 }
 } else {
 alert(data.errorMessage);
 }
 });
 };
 
 Stream.prototype.wallUnstick = function (url) {
 $.ajax({
 dataType: "json",
 type: 'post',
 url: url
 }).done(function (data) {
 if (data.success) {
 //Reload the whole stream, since we have to reorder the entries
 currentStream.showStream();
 }
 });
 };
 
 /**
 * Click Handler for Archive Link of Wall Posts
 * (archiveLink.php)
 * 
 * @param {type} className
 * @param {type} id
 
 Stream.prototype.wallArchive = function (id) {
 
 url = wallArchiveLinkUrl.replace('-id-', id);
 
 $.ajax({
 dataType: "json",
 type: 'post',
 url: url
 }).done(function (data) {
 if (data.success) {
 if (currentStream) {
 $.each(data.wallEntryIds, function (k, wallEntryId) {
 //currentStream.reloadWallEntry(wallEntryId);
 // fade out post
 setInterval(fadeOut(), 1000);
 
 function fadeOut() {
 // fade out current archived post
 $('#wallEntry_' + wallEntryId).fadeOut('slow');
 }
 });
 }
 }
 });
 };
 
 
 /**
 * Click Handler for Un Archive Link of Wall Posts
 * (archiveLink.php)
 * 
 * @param {type} className
 * @param {type} id
 
 Stream.prototype.wallUnarchive = function (id) {
 url = wallUnarchiveLinkUrl.replace('-id-', id);
 
 $.ajax({
 dataType: "json",
 type: 'post',
 url: url
 }).done(function (data) {
 if (data.success) {
 if (currentStream) {
 $.each(data.wallEntryIds, function (k, wallEntryId) {
 currentStream.reloadWallEntry(wallEntryId);
 });
 
 }
 }
 });
 };
 
 
 /*
 module.StreamItem.prototype.highlightContent = function () {
 var $content = this.getContent();
 $content.addClass('highlight');
 $content.delay(200).animate({backgroundColor: 'transparent'}, 1000, function () {
 $content.removeClass('highlight');
 $content.css('backgroundColor', '');
 });
 };
 */    