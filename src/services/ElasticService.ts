module elasticui.services {
    export class ElasticService {
        public client;
        private esFactory;
        private host;
        private username;
        private password;

        static $inject = ['esFactory', 'euiHost', 'euiUser', 'euiPassword'];

        constructor(esFactory, euiHost, euiUser, euiPassword) {
            this.esFactory = esFactory;
            this.username = euiUser || '';
            this.password = euiPassword || '';
            this.setHost(euiHost);
        }

        public setHost(host) {
            if (host === this.host) {
                return false;
            }
            //Add basic auth if username and password provided
            if (this.username && this.password) {
                this.host = [
                    {
                        host: host,
                        auth: this.username + ':' + this.password
                    }
                ]
            }
            else {
                this.host = host;
            }

            this.client = this.esFactory({
                host: this.host,
                calcDeadTimeout: "flat"
            });

            return true;
        }
    }
    services.service('es', ElasticService);
}
