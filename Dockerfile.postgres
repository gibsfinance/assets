# Start from the official PostgreSQL image
FROM postgres:13

# Install Python and the necessary PostgreSQL packages for PL/Python
RUN apt-get update --fix-missing
RUN apt-get install -y --fix-missing postgresql-plpython3-13 postgresql-contrib python3-pip

# Install the pysha3 library
RUN pip3 install safe-pysha3 --break-system-packages

ENV PGDATA="/var/lib/postgresql/data/pgdata13"

CMD ["docker-entrypoint.sh"]
