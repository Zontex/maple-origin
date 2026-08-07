import { OutPacket, OutPacketOpcode } from '../OutPacket';

export default class LoginPacket extends OutPacket {
  constructor(
    public username: string,
    public password: string,
  ) {
    super(OutPacketOpcode.LOGIN);

    const volumeSerialNumber = this.getVolumeSerialNumber();

    const part1 = volumeSerialNumber.substr(0, 2);
    const part2 = volumeSerialNumber.substr(2, 2);
    const part3 = volumeSerialNumber.substr(4, 2);
    const part4 = volumeSerialNumber.substr(6, 2);

    const h = this.hexToDec(part4);
    const w = this.hexToDec(part3);
    const i = this.hexToDec(part2);
    const d = this.hexToDec(part1);

    this.writeString(username);
    this.writeString(password);

    this.skip(6);

    this.writeByte(h);
    this.writeByte(w);
    this.writeByte(i);
    this.writeByte(d);
  }

  private getVolumeSerialNumber() {
    return '12345678'; // @todo: dummy now
  }
}
