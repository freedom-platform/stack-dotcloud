
export PINF_VERBOSE:=
export PINF_DEBUG:=

postinstall:
	if [ ! -h "/opt/node/default/bin/sm" ]; then ln -s /home/dotcloud/code/node_modules/sm/bin/sm-cli /opt/node/default/bin/sm ; fi
	cd /home/dotcloud/code ; npm install
	cd /home/dotcloud/code ; sm status
	sm status
