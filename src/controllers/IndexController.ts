module elasticui.controllers {
    import IHttpService = ng.IHttpService;
    import IQService = ng.IQService;

    import IAngularStatic = ng.IAngularStatic;
    export class IndexController {
        private esHost: any;
        private angular:IAngularStatic;
        private es:services.ElasticService;
        private http:IHttpService;
        private q:IQService;
        private $rootScope:any;

        public filters = new elasticui.util.FilterCollection();

        public indexVM:IIndexViewModel = {
            host: null,
            query: null,
            sort: null,
            aggregationProviders: new elasticui.util.SimpleSet(),
            filters: this.filters,
            highlight: null,
            loaded: false,
            page: 1,
            index: null,
            loading: false,
            pageCount: 0,
            pageSize: 10,
            results: null,
            refresh: (softRefresh:boolean = true) => this.refresh(softRefresh),
            error: null,
            autoLoad: true
        };

        public loaded() {
            if (!this.indexVM.loaded) {
                this.indexVM.loaded = true;

                if (this.indexVM.autoLoad) {
                    this.search();
                }
            }
        }

        static $inject = ['$scope', '$timeout', '$window', 'es', '$rootScope', '$http', '$q', 'euiHost'];

        constructor($scope, $timeout, $window, es:services.ElasticService, $rootScope, $http, $q, euiHost) {
            this.es = es;
            this.$rootScope = $rootScope;
            this.http = $http;
            this.q = $q;
            this.esHost = euiHost || '';

            $scope.indexVM = this.indexVM;
            $scope.ejs = $window.ejs; // so we can use ejs in attributes etc. TODO: better to have a ejs service instead of loading from window
            $scope.filters = this.filters;
            $scope.$watchCollection('indexVM.filters.ejsObjects', () => {
                this.indexVM.page = 1;
                this.search()
            });
            $scope.$watchCollection('indexVM.aggregationProviders.objects', () => this.search());

            $scope.$watch('indexVM.host', () => {
                if (this.indexVM.host != null && es.setHost(this.indexVM.host)) {
                    this.search();
                }
            });
            $scope.$watch('indexVM.sort', () => {
                this.indexVM.page = 1;
                this.search()
            });
            $scope.$watch('indexVM.pageSize', () => {
                this.indexVM.page = 1;
                this.search()
            });
            $scope.$watch('indexVM.page', () => this.search());
            $scope.$watch('indexVM.index', () => this.search());
            $scope.$watch('indexVM.query', () => this.search());
            $scope.$watch('indexVM.highlight', () => this.search());

            $timeout(() => this.loaded(), 200); // TODO: find better way to recognize loading of app
        }

        private getSearchPromise() {
            var request = ejs.Request();


            for (var i = 0; i < this.indexVM.aggregationProviders.objects.length; i++) {
                var provider = this.indexVM.aggregationProviders.objects[i];
                var agg = provider(this.filters.ejsObjects);
                request.agg(agg);
            }

            // apply search filters to the request
            var queryWrapper = {
                request: {}
            };
            var combinedFilter = this.filters.getAsFilter();
            if (combinedFilter != null) {
                request.filter(combinedFilter);
            }

            if (this.indexVM.query != null) {
                request.query(this.indexVM.query);
            } else {
                request.query(ejs.MatchAllQuery());
            }

            if (this.indexVM.sort != null) {
                request.sort(this.indexVM.sort);
            }

            if (this.indexVM.highlight != null) {
                request.highlight(this.indexVM.highlight);
            }

            //console.log("request to ES");
            //request.size = this.indexVM.pageSize;
            //request.from = this.indexVM.pageSize * (this.indexVM.page-1);

            var preReq = JSON.parse(JSON.stringify(request));
            //console.log(preReq);
            console.log(JSON.stringify(preReq));
            preReq['size'] = this.indexVM.pageSize;
            preReq['from'] = this.indexVM.pageSize * (this.indexVM.page - 1);
            queryWrapper.request = preReq;

            //var res = this.es.client.search({
            //    index: this.indexVM.index,
            //    size: this.indexVM.pageSize,
            //    from: this.indexVM.pageSize * (this.indexVM.page-1),
            //    body: request
            //});
            //
            //console.log(res);

            var res = this.http.post(this.esHost, queryWrapper);
            console.log(res);
            var self = this;
            var rejection = this.q.defer();

            res.then(function (response) {
                    return (response.data);
                },
                function (aborted) {
                    return self.q.reject(aborted);
                });


            res['abort'] = function () {
                rejection.resolve();
            };

            res.finally(function () {
                res['abort'] = self.angular.noop;
                rejection = request = res = null;

            });

            return res;
        }


        private searchPromise = null;
        private refreshPromise = null;

        private onError(err) {
            this.$rootScope.$broadcast('eui-search-error', err);
            this.indexVM.error = err;
        }

        private search() {
            if (!this.indexVM.loaded || !this.indexVM.index) {
                return;
            }
            if (this.refreshPromise != null) {
                var promiseToAbort = this.refreshPromise;
                this.refreshPromise = null;
                promiseToAbort.abort();
            }

            if (this.searchPromise != null) {
                var promiseToAbort = this.searchPromise;
                this.searchPromise = null;
                promiseToAbort.abort();
            }

            this.indexVM.loading = true;
            this.searchPromise = this.getSearchPromise();
            this.searchPromise.then((body) => {
                this.searchPromise = null;
                this.indexVM.error = null;
                this.onResult(body.data);
            }, (err) => {
                if (this.searchPromise) { // if set to null it was aborted (for simple client)
                    this.searchPromise = null;
                    this.onError(err);
                }
            });
        }

        public refresh(softRefresh:boolean = true) {
            if (!this.indexVM.loaded || !this.indexVM.index || this.searchPromise != null) {
                return;
            }
            this.indexVM.loading = true;
            this.refreshPromise = this.getSearchPromise();
            this.refreshPromise.then((body) => {
                this.refreshPromise = null;
                this.indexVM.error = null;
                this.onResult(body.data, softRefresh);
            }, (err) => {
                if (this.refreshPromise) { // if set to null it was aborted (for simple client)
                    this.refreshPromise = null;
                    this.onError(err);
                }
            });
        }

        private onResult(body, updateOnlyIfCountChanged:boolean = false) {
            if (!updateOnlyIfCountChanged || this.indexVM.results == null || this.indexVM.results.hits.total != body.hits.total) {
                this.indexVM.results = body;
                this.indexVM.pageCount = Math.ceil(this.indexVM.results.hits.total / this.indexVM.pageSize);
            }
            this.indexVM.loading = false;
        }
    }
}
