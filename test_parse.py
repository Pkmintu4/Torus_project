def decode_sw(val: str):
    try:
        n   = int(val)
        swm = 'ON' if (n & 0b01) else 'OFF'
        swl = 'ON' if (n & 0b10) else 'OFF'
        return swm, swl
    except ValueError:
        return '?', '?'

def parse_packet(line: str):
    SKIP_TOKENS = ('===', 'BOOT', 'LOOP', 'ERROR', 'OK:', 'HX711', 'BNO')
    line = line.strip()
    if not line or any(t in line for t in SKIP_TOKENS):
        return "skipped by SKIP_TOKENS"
    data = {}
    try:
        for field in line.split('|'):
            if ':' not in field:
                continue
            key, _, value = field.partition(':')
            key, value = key.strip(), value.strip()

            if key in ('JX', 'JY', 'JZ'):
                data[key] = int(value)
            elif key == 'SW':
                swm, swl    = decode_sw(value)
                data['SWM'] = swm
                data['SWL'] = swl
                data['SW']  = value             
            elif key in ('IMU1', 'IMU2'):
                data[key] = value               
            elif key == 'HX':
                data[key] = None if value == 'NOT_READY' else float(value)
            else:
                data[key] = value

        if not {'JX', 'JY', 'JZ'}.issubset(data):
            return "skipped by issubset"
        return data
    except Exception as e:
        return f"Exception: {e}"

print(parse_packet("JX:1973|JY:2060|JZ:2042|SWM:ON|SWL:OFF|HX:0.00|I1:0.952,0.097,-0.126,-0.263|I2:0.181,-0.369,0.704,-0.579"))
