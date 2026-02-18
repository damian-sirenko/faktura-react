CREATE TABLE autoclaves (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(20) NOT NULL,
    serial_number VARCHAR(50) NOT NULL UNIQUE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE sterilization_cycles (
    id INT AUTO_INCREMENT PRIMARY KEY,

    autoclave_id INT NOT NULL,
    cycle_number VARCHAR(20) NOT NULL,

    cycle_start_datetime DATETIME NOT NULL,

    program VARCHAR(100),

    sterilization_start DATETIME,
    sterilization_end DATETIME,
    sterilization_duration_seconds INT,

    pressure_min INT,
    pressure_max INT,

    cycle_type ENUM('NORMAL','TEST','REJECTED') NOT NULL,
    status ENUM('IMPORTED','READY','APPROVED','REJECTED') DEFAULT 'IMPORTED',

    operator_user_id BIGINT UNSIGNED,

    report_file_path VARCHAR(500),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_cycle (autoclave_id, cycle_number),

    FOREIGN KEY (autoclave_id) REFERENCES autoclaves(id),
    FOREIGN KEY (operator_user_id) REFERENCES users(id)
);


CREATE TABLE sterilization_cycle_clients (
    id INT AUTO_INCREMENT PRIMARY KEY,

    cycle_id INT NOT NULL,
    client_id VARCHAR(191) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_cycle_client (cycle_id, client_id),

    FOREIGN KEY (cycle_id) REFERENCES sterilization_cycles(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
);
